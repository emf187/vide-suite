"use server";

import { redirect } from "next/navigation";
import { requireCtx } from "@/server/ctx";
import { reportsWriteService } from "@/server/services/reports";

export async function generateReportAction(form: FormData): Promise<void> {
  const kind = String(form.get("kind") ?? "plant_summary");
  const days = Number(form.get("days") ?? 30);
  const back = `/reports?error=${encodeURIComponent("not_saved")}`;
  if (!["plant_summary", "machine_status"].includes(kind)) redirect(back);
  if (![7, 30, 90].includes(days)) redirect(back);
  const ctx = await requireCtx();
  const machineId = String(form.get("machineId") ?? "");
  if (kind === "machine_status" && !machineId) redirect(`/reports?error=${encodeURIComponent("machine_required")}`);
  const to = new Date();
  const from = new Date(Date.now() - days * 86_400_000);
  let reportId: string;
  try {
    ({ reportId } = await reportsWriteService.generate(ctx, {
      kind: kind as "plant_summary" | "machine_status",
      machineId: kind === "machine_status" ? machineId : null,
      from,
      to,
    }));
  } catch (err) {
    redirect(`/reports?error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
  }
  redirect(`/reports/${reportId}`);
}
