import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { csvFilename, reportsService, reportToCsv } from "@/server/services/reports";

/** Session-gated CSV export — same content as the calc bundle, served as text/csv. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const ctx = await getCtx();
  if (!ctx) return new Response("unauthorized", { status: 401 });
  if (!can(ctx.roles, "report.view")) return new Response("forbidden", { status: 403 });

  const { id } = await params;
  const r = await reportsService.byId(ctx, id);
  if (!r) return new Response("not_found", { status: 404 });

  return new Response(reportToCsv(r), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${csvFilename(r)}"`,
      "cache-control": "no-store",
    },
  });
}
