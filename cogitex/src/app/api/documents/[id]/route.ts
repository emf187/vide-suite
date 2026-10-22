import { requireCtx } from "@/server/ctx";
import { documentsService } from "@/server/services/documents";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const found = await documentsService.download(ctx, id);
  if (!found) return new Response("Not found", { status: 404 });
  if (found.doc.scanStatus === "quarantined") return new Response("Quarantined", { status: 403 });

  return new Response(new Uint8Array(found.bytes), {
    headers: {
      "Content-Type": found.doc.mimeType,
      "Content-Disposition": `inline; filename="${found.doc.name.replace(/["\\]/g, "")}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
