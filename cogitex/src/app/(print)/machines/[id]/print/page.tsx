import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { renderMarkdown } from "@/lib/markdown";
import { formatDateTime } from "@/lib/time";
import { getCtx } from "@/server/ctx";
import { getDb } from "@/server/db/client";
import { machineDevices, workOrders } from "@/server/db/schema";
import { machinesService } from "@/server/services/machines";
import { notesService } from "@/server/services/machine-notes";
import { faultsService } from "@/server/services/faults";
import { documentsService } from "@/server/services/documents";
import { can } from "@/server/policies";

export const metadata = { title: "Machine dossier" };
export const dynamic = "force-dynamic";

const OPEN_WO = ["draft", "planned", "assigned", "in_progress", "on_hold"] as const;

/**
 * Machine dossier — the ONE print surface: everything about a machine in a
 * single ink-friendly sheet (browser print / save-as-PDF). Lives outside the
 * (app) shell group so the sidebar/topbar never pollute the sheet; it stays a
 * plain server page — no JS needed, the PRINT button is pure enhancement.
 */
export default async function DossierPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) {
    const { id } = await params;
    return (
      <div style={{ padding: 40 }}>
        <p>Signed out. <Link href="/login">Sign in</Link> to open this dossier.</p>
      </div>
    );
  }

  const { id } = await params;
  const machine = await machinesService.byId(ctx, id);
  if (!machine) notFound();
  if (!can(ctx.roles, "report.view")) notFound(); // dossier mirrors report-level visibility

  const db = await getDb();
  const [noteRows, faultRows, docRows, woRows, deviceLinks] = await Promise.all([
    notesService.list(ctx, machine.id),
    faultsService.list(ctx, { machineId: machine.id }),
    documentsService.listForMachine(ctx, machine.id),
    db
      .select({
        number: workOrders.number,
        title: workOrders.title,
        status: workOrders.status,
        priority: workOrders.priority,
        plannedEnd: workOrders.plannedEnd,
        createdAt: workOrders.createdAt,
      })
      .from(workOrders)
      .where(and(eq(workOrders.organizationId, ctx.orgId), eq(workOrders.machineId, machine.id)))
      .orderBy(desc(workOrders.createdAt))
      .limit(25),
    db
      .select({ videMachineName: machineDevices.videMachineName })
      .from(machineDevices)
      .where(
        and(
          eq(machineDevices.organizationId, ctx.orgId),
          eq(machineDevices.machineId, machine.id),
          isNull(machineDevices.unlinkedAt),
        ),
      )
      .limit(1),
  ]);

  const videDevice = deviceLinks[0]?.videMachineName ?? null;

  const openWork = woRows.filter((w) => (OPEN_WO as readonly string[]).includes(w.status));
  const recentWork = woRows.filter((w) => !(OPEN_WO as readonly string[]).includes(w.status)).slice(0, 10);
  const openFaults = faultRows.filter((f) => f.status === "open");
  const pastFaults = faultRows.filter((f) => f.status !== "open").slice(0, 10);

  return (
    <div className="dossier">
      <style>{dossierCss}</style>

      <header className="dossier-head no-screen-hide">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <h1 style={{ fontSize: 22, margin: "0 0 2px" }}>
            {machine.tag} <span style={{ fontWeight: 400 }}>· {machine.name}</span>
          </h1>
          <span className="tag">CRITICALITY {machine.criticality} · {machine.lifecycleStatus.toUpperCase()}</span>
        </div>
        <p style={{ fontSize: 11, color: "#555", margin: 0 }}>
          {machine.category}
          {machine.make || machine.model || machine.serialNumber
            ? ` · ${[machine.make, machine.model, machine.serialNumber].filter(Boolean).join(" / ")}`
            : ""}
          {machine.locationNote ? ` · ${machine.locationNote}` : ""}
          {machine.runtimeHours ? ` · ${machine.runtimeHours} h runtime` : ""}
          {machine.installDate ? ` · installed ${machine.installDate}` : ""}
          {machine.warrantyUntil ? ` · warranty until ${machine.warrantyUntil}` : ""}
        </p>
        <p style={{ fontSize: 10, color: "#888", margin: "6px 0 0" }}>
          ORGO · MAINTENANCE MANAGER — dossier generated {formatDateTime(new Date())} · org {ctx.orgName}
        </p>
      </header>

      <section className="dossier-block no-screen-hide">
        <div className="eyebrow">IDENTITY</div>
        <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
          <tbody>
            {[
              ["Tag / name", `${machine.tag} · ${machine.name}`],
              ["Category", machine.category],
              ["Make / model / serial", [machine.make, machine.model, machine.serialNumber].filter(Boolean).join(" / ") || "—"],
              ["Criticality / lifecycle", `${machine.criticality} · ${machine.lifecycleStatus}`],
              ["Location note", machine.locationNote ?? "—"],
              ["Runtime hours", String(machine.runtimeHours ?? "0")],
              ["Install / warranty", [machine.installDate, machine.warrantyUntil].filter(Boolean).join(" → ") || "—"],
              ["Linked VIDE device", videDevice ?? "— (no live telemetry)"],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ padding: "5px 10px 5px 0", color: "#555", whiteSpace: "nowrap", width: 170 }}>{k}</td>
                <td style={{ padding: 5 }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {Object.keys(machine.ratedSpecs ?? {}).length > 0 ? (
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", marginTop: 6 }}>
            <tbody>
              {Object.entries(machine.ratedSpecs as Record<string, unknown>).map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: "5px 10px 5px 0", color: "#555", whiteSpace: "nowrap", width: 170 }}>Spec · {k}</td>
                  <td style={{ padding: 5 }}>{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section className="dossier-block">
        <div className="eyebrow">WORK ORDERS</div>
        {woRows.length === 0 ? (
          <p className="empty-state">No work orders on record.</p>
        ) : (
          <>
            {openWork.length > 0 ? (
              <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["OPEN / IN FLIGHT · NO", "TITLE", "STATUS", "PRIORITY", "PLANNED END"].map((h) => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {openWork.map((w) => (
                    <tr key={w.number}>
                      <td>{w.number}</td>
                      <td>{w.title}</td>
                      <td>{w.status}</td>
                      <td>{w.priority}</td>
                      <td>{w.plannedEnd ? formatDateTime(w.plannedEnd) : "unscheduled"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty-state">Nothing open — backlog is clear.</p>
            )}
            {recentWork.length > 0 ? (
              <p style={{ fontSize: 10, color: "#555", margin: "10px 0 4px" }}>
                RECENT CLOSED / CANCELLED — {recentWork.map((w) => `${w.number} ${w.title} (${w.status})`).join(" · ")}</p>
            ) : null}
          </>
        )}
      </section>

      <section className="dossier-block">
        <div className="eyebrow">FAULTS</div>
        {faultRows.length === 0 ? (
          <p className="empty-state">No faults recorded.</p>
        ) : (
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
            <thead>
              <tr>{["SEVERITY", "TYPE", "STATE", "FLAGGED", "DESCRIPTION"].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {[...openFaults, ...pastFaults].slice(0, 20).map((f) => (
                <tr key={f.id}>
                  <td>{f.severity}</td>
                  <td>{f.faultType}</td>
                  <td>{f.status}</td>
                  <td>{f.flaggedAt ? formatDateTime(f.flaggedAt) : "—"}</td>
                  <td style={{ color: "#555" }}>{f.description?.slice(0, 140) ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="dossier-block">
        <div className="eyebrow">NOTES</div>
        {noteRows.length === 0 ? (
          <p className="empty-state">No notes.</p>
        ) : (
          noteRows.slice(0, 20).map((n) => (
            <article key={n.id} style={{ breakInside: "avoid", marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700 }}>
                {n.title} <span style={{ fontWeight: 400, color: "#777", fontSize: 10 }}>· {formatDateTime(n.createdAt)}</span>
              </div>
              <div style={{ fontSize: 11, marginTop: 3 }} dangerouslySetInnerHTML={{ __html: renderMarkdown(n.body) }} />
            </article>
          ))
        )}
      </section>

      <section className="dossier-block">
        <div className="eyebrow">DOCUMENTS</div>
        {docRows.length === 0 ? (
          <p className="empty-state">No documents on file.</p>
        ) : (
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
            <thead>
              <tr>{["NAME", "KIND", "SIZE", "UPLOADED"].map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {docRows.slice(0, 30).map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.kind}</td>
                  <td>{Math.round(d.sizeBytes / 102.4) / 10} KB</td>
                  <td>{formatDateTime(d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer style={{ fontSize: 9, color: "#999", marginTop: 18, borderTop: "1px solid #ddd", paddingTop: 8 }}>
        ORGO · append-only records snapshot — this sheet is generated fresh on every load; live state lives in the planner.
      </footer>
    </div>
  );
}

const dossierCss = `
.dossier { max-width: 860px; margin: 0 auto; padding: 28px 16px 60px; font-family: var(--font-sans); color: #111; }
.dossier-head { border-bottom: 2px solid #222; padding-bottom: 10px; margin-bottom: 14px; }
.dossier-block { margin-bottom: 18px; break-inside: avoid; }
.dossier .eyebrow { font-size: 10px; letter-spacing: 2px; color: var(--accent); font-weight: 700; margin-bottom: 6px; }
.dossier table th { text-align: left; padding: 6px 10px 6px 0; border-bottom: 1px solid #ccc; font-size: 9px; letter-spacing: 1.5px; color: #666; }
.dossier table td { padding: 5px 10px 5px 0; border-bottom: 1px solid #eee; vertical-align: top; }
.dossier .empty-state { font-size: 11px; color: #777; font-style: italic; }
.dossier .print-only-button { margin: 0 0 14px; background: none; border: 1px solid #ccc; border-radius: 8px; padding: 8px 14px; cursor: pointer; font-size: 11px; letter-spacing: 1px; }
@media print {
  .dossier { padding: 0; max-width: none; }
  .print-only-button { display: none; }
  .dossier-block, .dossier-head { break-inside: avoid; }
  a { text-decoration: none; color: inherit; }
}
`;
