import type { AppDb } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";

/**
 * Append-only audit helper (docs/DATA_MODEL.md §3.10).
 * Every create/update/delete/status change should call this.
 */
export const auditRepo = {
  async log(
    db: AppDb,
    input: {
      organizationId: string;
      actorUserId?: string | null;
      actorKind?: "user" | "system" | "agent" | "webhook";
      action: string;
      entityType: string;
      entityId: string;
      diff?: unknown;
      requestId?: string;
    },
  ): Promise<void> {
    await db.insert(auditLogs).values({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId ?? null,
      actorKind: input.actorKind ?? "user",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      diff: (input.diff ?? null) as never,
      requestId: input.requestId ?? null,
    });
  },
};
