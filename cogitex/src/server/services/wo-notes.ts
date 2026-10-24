/**
 * Work-order comment thread (docs & multimedia sprint, docs/DATA_MODEL.md §3.15).
 *
 * Two kinds and a hard rule:
 * - 'comment' rows are human conversation: markdown, optional document attachment
 *   (camera photos land in the documents file-store with work_order_id set),
 *   soft-delete + audit.
 * - 'system' rows are provenance written ONCE by the machines that create cards
 *   (PM schedules, VIDE fault conversion, agent proposals) — never editable,
 *   never deletable, so the timeline always answers "why does this card exist".
 *
 * Tenancy: every path first resolves the WO inside ctx.orgId — wrong-org or
 * guessed ids read as wo_not_found / note_not_found, never a blind write.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb, type AppDb } from "@/server/db/client";
import { woNotes, workOrders, type WorkOrderNote } from "@/server/db/schema";
import { auditRepo } from "@/server/repos/audit";

export const MAX_COMMENT_BODY = 4000;

export const woNotesService = {
  /** Org-scoped read: the comment thread for one card, oldest first. */
  async list(ctx: Ctx, workOrderId: string): Promise<WorkOrderNote[]> {
    const db = await getDb();
    return db
      .select()
      .from(woNotes)
      .where(
        and(
          eq(woNotes.organizationId, ctx.orgId),
          eq(woNotes.workOrderId, workOrderId),
          isNull(woNotes.deletedAt),
        ),
      )
      .orderBy(asc(woNotes.createdAt), asc(woNotes.id));
  },

  /** Internal guard used by add/remove (kept here so callers never write blind). */
  async requireWorkOrder(ctx: Ctx, db: AppDb, workOrderId: string): Promise<{ id: string; number: string }> {
    const rows = await db
      .select({ id: workOrders.id, number: workOrders.number })
      .from(workOrders)
      .where(and(eq(workOrders.organizationId, ctx.orgId), eq(workOrders.id, workOrderId)))
      .limit(1);
    const wo = rows[0];
    if (!wo) throw new Error("wo_not_found");
    return wo;
  },

  async add(
    ctx: Ctx,
    workOrderId: string,
    input: { body: string; documentId?: string | null },
  ): Promise<WorkOrderNote> {
    const body = input.body.trim();
    if (!body) throw new Error("body_required");
    if (body.length > MAX_COMMENT_BODY) throw new Error(`body_too_large:${MAX_COMMENT_BODY}`);
    const db = await getDb();
    const wo = await this.requireWorkOrder(ctx, db, workOrderId);
    const inserted = await db
      .insert(woNotes)
      .values({
        organizationId: ctx.orgId,
        workOrderId: wo.id,
        authorId: ctx.userId,
        createdBy: ctx.userId,
        kind: "comment",
        body,
        documentId: input.documentId ?? null,
      })
      .returning();
    const note = inserted[0];
    if (!note) throw new Error("comment insert returned no rows");
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "wo.comment_added",
      entityType: "work_order",
      entityId: wo.id,
      diff: { noteId: note.id, woNumber: wo.number, withAttachment: Boolean(input.documentId) },
    });
    return note;
  },

  /** Provenance rail: called from work-order creation/fault conversion. No audit here — the source event is the audit. */
  async system(db: AppDb, ctx: Ctx, workOrderId: string, body: string): Promise<void> {
    await db.insert(woNotes).values({
      organizationId: ctx.orgId,
      workOrderId,
      kind: "system",
      body,
      createdBy: ctx.userId,
    });
  },

  /** Soft delete, audited. 'system' provenance rows can never be removed. */
  async remove(ctx: Ctx, workOrderId: string, noteId: string): Promise<void> {
    const db = await getDb();
    const wo = await this.requireWorkOrder(ctx, db, workOrderId);
    const rows = await db
      .select()
      .from(woNotes)
      .where(
        and(
          eq(woNotes.organizationId, ctx.orgId),
          eq(woNotes.workOrderId, workOrderId),
          eq(woNotes.id, noteId),
          isNull(woNotes.deletedAt),
        ),
      )
      .limit(1);
    const note = rows[0];
    if (!note) throw new Error("note_not_found");
    if (note.kind === "system") throw new Error("system_note_immutable");
    await db
      .update(woNotes)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(woNotes.id, noteId));
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "wo.comment_removed",
      entityType: "work_order",
      entityId: wo.id,
      diff: { noteId, woNumber: wo.number },
    });
  },
};
