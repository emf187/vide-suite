import { and, eq, isNull, or } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb, type AppDb } from "@/server/db/client";
import { documents, documentBlobs, type DocumentRow } from "@/server/db/schema";
import { auditRepo } from "@/server/repos/audit";
import { createHash } from "node:crypto";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB per file in M1 (DB-backed storage)
const ALLOWED_PREFIXES = ["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain", "text/csv"];
const DANGEROUS_NAMES = /\.(exe|bat|cmd|js|vbs|ps1|sh|dll|scr)$/i;

/**
 * Documents service (docs/DATA_MODEL.md documents + storage adapter note).
 * M1 storage backend: database bytea (works on Vercel, no S3 needed for the demo).
 * The scan hook is a pluggable no-op that quarantines by extension until a real scanner is wired.
 */
export const documentsService = {
  async upload(
    ctx: Ctx,
    input: {
      machineId?: string | null;
      workOrderId?: string | null;
      kind: (typeof documents.$inferSelect)["kind"];
      name: string;
      mimeType: string;
      bytes: Buffer;
    },
  ): Promise<DocumentRow> {
    if (input.bytes.byteLength === 0) throw new Error("empty_file");
    if (input.bytes.byteLength > MAX_BYTES) throw new Error("file_too_large:5MB");
    const safeMime = ALLOWED_PREFIXES.some((p) => input.mimeType.startsWith(p)) ? input.mimeType : "application/octet-stream";
    const scanStatus = DANGEROUS_NAMES.test(input.name) ? "quarantined" : "unscanned";

    const db = await getDb();
    const rows = await db
      .insert(documents)
      .values({
        organizationId: ctx.orgId,
        machineId: input.machineId ?? null,
        workOrderId: input.workOrderId ?? null,
        kind: input.kind,
        name: input.name.slice(0, 200),
        mimeType: safeMime,
        sizeBytes: input.bytes.byteLength,
        checksumSha256: createHash("sha256").update(input.bytes).digest("hex"),
        scanStatus,
        uploadedBy: ctx.userId,
      })
      .returning();
    const doc = rows[0];
    if (!doc) throw new Error("document insert returned no rows");
    await db.insert(documentBlobs).values({ documentId: doc.id, bytes: input.bytes });

    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "document.created",
      entityType: "document",
      entityId: doc.id,
      diff: { name: doc.name, kind: doc.kind, machineId: doc.machineId, scanStatus },
    });
    return doc;
  },

  async listForMachine(ctx: Ctx, machineId: string): Promise<DocumentRow[]> {
    const db = await getDb();
    return db
      .select()
      .from(documents)
      .where(and(eq(documents.organizationId, ctx.orgId), eq(documents.machineId, machineId), isNull(documents.deletedAt)))
      .orderBy(documents.createdAt);
  },

  async download(ctx: Ctx, documentId: string): Promise<{ doc: DocumentRow; bytes: Buffer } | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, ctx.orgId), isNull(documents.deletedAt)))
      .limit(1);
    const doc = rows[0];
    if (!doc) return null;
    const blobRows = await db.select().from(documentBlobs).where(eq(documentBlobs.documentId, doc.id)).limit(1);
    const bytes = blobRows[0]?.bytes;
    if (!bytes) return null;
    return { doc, bytes: Buffer.from(bytes) };
  },

  async softDelete(ctx: Ctx, documentId: string): Promise<void> {
    const db = await getDb();
    const rows = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, ctx.orgId), isNull(documents.deletedAt)))
      .limit(1);
    if (!rows[0]) throw new Error("document_not_found");
    await db
      .update(documents)
      .set({ deletedAt: new Date() })
      .where(eq(documents.id, documentId));
    await auditRepo.log(db, {
      organizationId: ctx.orgId,
      actorUserId: ctx.userId,
      action: "document.deleted",
      entityType: "document",
      entityId: documentId,
    });
  },
};
