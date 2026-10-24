import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { reportsService, reportToPdfBytes } from "@/server/services/reports";

/** Session-gated PDF export — pdf-lib render of the deterministic calc bundle. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const ctx = await getCtx();
  if (!ctx) return new Response("unauthorized", { status: 401 });
  if (!can(ctx.roles, "report.view")) return new Response("forbidden", { status: 403 });

  const { id } = await params;
  const r = await reportsService.byId(ctx, id);
  if (!r) return new Response("not_found", { status: 404 });

  const bytes = await reportToPdfBytes({
    kind: r.kind,
    orgName: ctx.orgName,
    periodFrom: r.periodFrom,
    periodTo: r.periodTo,
    calc: r.calc,
  });

  const stamp = r.generatedAt.toISOString().slice(0, 10);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="orgo-${r.kind}-${stamp}.pdf"`,
      "cache-control": "no-store",
    },
  });
}
