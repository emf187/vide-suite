/**
 * Conversation state (brief §5): one live record per person, stored in the
 * database — never in memory. States expire (default 30 min); an expired or
 * absent state reads as idle. EVERY transition is written to the audit log
 * before the reply goes out — the owner can reconstruct any chat decision.
 */
import { eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/client";
import { getDb } from "@/server/db/client";
import { conversationStates } from "@/server/db/schema";
import { auditRepo } from "@/server/repos/audit";
import type { ConversationStateName } from "@/lib/shared/types";

export type LiveState = {
  state: ConversationStateName;
  context: Record<string, unknown>;
  /** true when a live record existed but its TTL ran out — caller may tell the person (§4.8). */
  expired: boolean;
};

export const conversationStateService = {
  async get(personId: string): Promise<LiveState> {
    const db = (await getDb()) as AppDb;
    const rows = await db.select().from(conversationStates).where(eq(conversationStates.personId, personId)).limit(1);
    const row = rows[0];
    if (!row) return { state: "idle", context: {}, expired: false };
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
      return { state: "idle", context: {}, expired: true };
    }
    return {
      state: row.state as ConversationStateName,
      context: (row.context ?? {}) as Record<string, unknown>,
      expired: false,
    };
  },

  async set(
    personId: string,
    orgId: string,
    state: ConversationStateName,
    context: Record<string, unknown> = {},
    ttlMinutes: number | null = 30,
  ): Promise<void> {
    const db = (await getDb()) as AppDb;
    const now = new Date();
    const expiresAt = ttlMinutes ? new Date(now.getTime() + ttlMinutes * 60_000) : null;
    await db
      .insert(conversationStates)
      .values({ personId, organizationId: orgId, state, context, expiresAt, updatedAt: now })
      .onConflictDoUpdate({
        target: conversationStates.personId,
        set: { state, context, expiresAt, updatedAt: now },
      });
    // The transition record — append-only audit, before anything is sent.
    await auditRepo.log(db, {
      organizationId: orgId,
      actorKind: "person",
      actorPersonId: personId,
      action: "conversation.state",
      entity: "conversation_state",
      entityId: personId,
      after: { state, context, expiresAt: expiresAt?.toISOString() ?? null },
    });
  },

  async reset(personId: string, orgId: string): Promise<void> {
    await this.set(personId, orgId, "idle", {}, null);
  },
};
