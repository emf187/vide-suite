import type { AppDb } from "@/server/db/client";
import { auditEvents } from "@/server/db/schema";

/** Append-only audit events (Custos §6). Always insert; never update/delete. */
export const auditRepo = {
  async log(
    db: AppDb,
    input: {
      organizationId: string;
      actorUserId?: string | null;
      actorPersonId?: string | null;
      actorKind?: "user" | "person" | "system" | "agent" | "webhook";
      action: string;
      entity: string;
      entityId: string;
      before?: unknown;
      after?: unknown;
    },
  ): Promise<void> {
    await db.insert(auditEvents).values({
      organizationId: input.organizationId,
      actorKind: input.actorKind ?? "user",
      actorUserId: input.actorUserId ?? null,
      actorPersonId: input.actorPersonId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      before: input.before ?? null,
      after: input.after ?? null,
    });
  },
};
