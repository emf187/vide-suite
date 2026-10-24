/**
 * Documentation library (docs & multimedia sprint, docs/DATA_MODEL.md §3.16):
 * one org-wide search across machine notes AND attachment documents — the
 * "where is everything written down" surface. Renders are programmatic (GET
 * form, no client JS). Matches stay tenant-scoped: every condition carries
 * organizationId, so cross-org leakage is structurally impossible.
 */
import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import type { Ctx } from "@/server/ctx";
import { getDb } from "@/server/db/client";
import { documents, machineNotes, machines } from "@/server/db/schema";

export type LibraryNote = {
  id: string;
  machineId: string;
  machineTag: string;
  machineName: string;
  title: string;
  body: string;
  source: string;
  documentId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LibraryDoc = {
  id: string;
  name: string;
  kind: string;
  mimeType: string;
  sizeBytes: number;
  workOrderId: string | null;
  machineTag: string | null;
  createdAt: Date;
};

export const libraryService = {
  async search(ctx: Ctx, opts: { q?: string; machineId?: string } = {}): Promise<{ notes: LibraryNote[]; docs: LibraryDoc[] }> {
    const db = await getDb();
    const q = opts.q?.trim().slice(0, 120) || null;
    const term = q ? `%${q}%` : null;

    const noteConds = [eq(machineNotes.organizationId, ctx.orgId), isNull(machineNotes.deletedAt)];
    if (opts.machineId) noteConds.push(eq(machineNotes.machineId, opts.machineId));
    if (term) {
      const s = or(ilike(machineNotes.title, term), ilike(machineNotes.body, term));
      if (s) noteConds.push(s);
    }
    const notes = (await db
      .select({
        id: machineNotes.id,
        machineId: machineNotes.machineId,
        machineTag: machines.tag,
        machineName: machines.name,
        title: machineNotes.title,
        body: machineNotes.body,
        source: machineNotes.source,
        documentId: machineNotes.documentId,
        createdAt: machineNotes.createdAt,
        updatedAt: machineNotes.updatedAt,
      })
      .from(machineNotes)
      .innerJoin(machines, eq(machines.id, machineNotes.machineId))
      .where(and(...noteConds))
      .orderBy(desc(machineNotes.createdAt))
      .limit(80)) as LibraryNote[];

    const docConds = [eq(documents.organizationId, ctx.orgId), isNull(documents.deletedAt)];
    if (opts.machineId) docConds.push(eq(documents.machineId, opts.machineId));
    if (term) {
      const s = ilike(documents.name, term);
      if (s) docConds.push(s);
    }
    const docs = (await db
      .select({
        id: documents.id,
        name: documents.name,
        kind: documents.kind,
        mimeType: documents.mimeType,
        sizeBytes: documents.sizeBytes,
        workOrderId: documents.workOrderId,
        machineTag: machines.tag,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .leftJoin(machines, eq(machines.id, documents.machineId))
      .where(and(...docConds))
      .orderBy(desc(documents.createdAt))
      .limit(80)) as LibraryDoc[];

    return { notes, docs };
  },
};
