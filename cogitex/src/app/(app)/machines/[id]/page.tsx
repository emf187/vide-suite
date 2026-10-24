import Link from "next/link";
import { notFound } from "next/navigation";
import type { Ctx } from "@/server/ctx";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { getIntegrations } from "@/lib/integrations/factory";
import { machinesService } from "@/server/services/machines";
import { faultsService, videCacheService } from "@/server/services/faults";
import { componentsService, listLinkedDevices, timelineService } from "@/server/services/machine-extras";
import { maintenanceHistoryService } from "@/server/services/machine-history";
import { notesService } from "@/server/services/machine-notes";
import { renderMarkdown } from "@/lib/markdown";
import { sitesService } from "@/server/services/sites";
import { documentsService } from "@/server/services/documents";
import { formatDateTime } from "@/lib/time";
import { formatKobo } from "@/lib/money";
import {
  addMachineExpenseAction,
  addMachineNoteAction,
  deleteDocumentAction,
  deleteMachineExpenseAction,
  deleteMachineNoteAction,
  editMachineNoteAction,
  importMachineNoteAction,
  saveComponentGridAction,
  transitionLifecycleAction,
  uploadDocumentAction,
} from "../actions";
import { COMPONENT_KINDS } from "@/lib/grid";

export const metadata = { title: "Machine" };

const TABS = [
  ["overview", "OVERVIEW"],
  ["health", "HEALTH"],
  ["energy", "ENERGY"],
  ["maintenance", "MAINTENANCE"],
  ["notes", "NOTES / DOCS"],
  ["parts", "PARTS / BOM"],
  ["documents", "ATTACHMENTS"],
  ["faults", "FAULTS"],
  ["timeline", "TIMELINE"],
] as const;

const STATUS_CLASS: Record<string, string> = {
  active: "urgency-none",
  standby: "urgency-low",
  under_maintenance: "urgency-medium",
  decommissioned: "urgency-high",
  commissioned: "urgency-low",
};

type HealthView =
  | { ok: true; score: number; status: string; asOf: string; samples: { at: string; score: number }[] }
  | { ok: false; message: string };

type EnergyView =
  | { ok: true; buckets: { at: string; kwh: number }[]; events: { at: string; eventType: string; detail?: string }[] }
  | { ok: false; message: string };

export default async function MachineProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; error?: string; uploaded?: string; deleted?: string; added?: string; lifecycle?: string; expense?: string; expense_error?: string; note?: string; note_error?: string; grid?: string; grid_error?: string; updated?: string; removed?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const { id } = await params;
  // Garbage ids ("null" from an unguarded link elsewhere) must fail soft, not 500.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const sp = await searchParams;
  const tab = (TABS.find((t) => t[0] === (sp.tab ?? "overview")) ?? TABS[0])[0];

  const machine = await machinesService.byId(ctx, id);
  if (!machine) notFound();

  const mayPlan = can(ctx.roles, "plan.manage");
  const mayDecommission = can(ctx.roles, "decommission.execute");
  const [devices, siteName, lifeCount] = await Promise.all([
    listLinkedDevices(ctx, machine.id),
    machine.siteId ? sitesService.list(ctx).then((sites) => sites.find((s) => s.id === machine.siteId)?.name ?? null) : Promise.resolve(null),
    timelineService.forMachine(ctx, machine.id),
  ]);
  const linkedNames = devices.filter((d) => d.unlinkedAt === null).map((d) => d.videMachineName);
  const videName: string | null = linkedNames[0] ?? null;
  const integrations = getIntegrations();

  async function loadHealth(c: Ctx, deviceName: string | null): Promise<HealthView | null> {
    if (!deviceName) return null;
    try {
      // M4: cache-through — adapter is hit only when the 10-minute TTL has lapsed
      const res = await videCacheService.getThrough(c, `health:${deviceName}:d7`, 10 * 60_000, async () => {
        const summary = await integrations.vide.getMachineHealthSummary(deviceName, "d7");
        return { score: summary.score, status: summary.status, asOf: summary.asOf, samples: summary.samples ?? [] } as Record<string, unknown>;
      });
      const p = res.payload as { score: number; status: string; asOf: string; samples?: { at: string; score: number }[] };
      return { ok: true, score: p.score, status: p.status, asOf: p.asOf, samples: p.samples ?? [] };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "adapter unavailable" };
    }
  }
  async function loadEnergy(c: Ctx, deviceName: string | null): Promise<EnergyView | null> {
    if (!deviceName) return null;
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
    try {
      // M4: cache-through, 30-minute TTL for the weekly energy view
      const res = await videCacheService.getThrough(c, `energy:${deviceName}:7d:day`, 30 * 60_000, async () => {
        const s = await integrations.vide.getEnergySummary({ machineName: deviceName, from, to, bucket: "day" });
        return { buckets: s.buckets, events: s.powerQuality ?? [] } as Record<string, unknown>;
      });
      const p = res.payload as { buckets?: { at: string; kwh: number }[]; events?: { at: string; eventType: string; detail?: string }[] };
      return { ok: true, buckets: p.buckets ?? [], events: p.events ?? [] };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "adapter unavailable" };
    }
  }
  async function loadFaults(c: Ctx, mId: string) {
    // M4: persisted fault events (webhook-ingested, resolved by device name)
    return faultsService.list(c, { machineId: mId });
  }
  async function loadDocs(c: Ctx, mId: string) {
    return documentsService.listForMachine(c, mId);
  }
  const loadParts = (c: Ctx, mId: string) => componentsService.listForMachine(c, mId);
  const loadNotes = (c: Ctx, mId: string) => notesService.list(c, mId);
  async function loadHistory(c: Ctx, mId: string) {
    return maintenanceHistoryService.forMachine(c, mId);
  }

  return (
    <>
      <div className="row" style={{ alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0 }}>{machine.tag}</h1>
          <p className="lead" style={{ margin: "4px 0 0" }}>
            {machine.name} · {machine.category} · criticality {machine.criticality}
            {siteName ? ` · ${siteName}` : ""}
          </p>
        </div>
        <span className={STATUS_CLASS[machine.lifecycleStatus] ?? ""} style={{ fontSize: 13 }}>{machine.lifecycleStatus}</span>
      </div>

      <nav className="card" style={{ padding: "10px 14px" }} aria-label="Machine sections">
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {TABS.map(([key, label]) => (
            <Link
              key={key}
              href={`/machines/${machine.id}?tab=${key}`}
              style={{
                textDecoration: "none",
                fontSize: 11,
                letterSpacing: 1,
                fontWeight: key === tab ? 700 : 400,
                color: key === tab ? "var(--accent)" : "var(--dim2)",
                borderBottom: key === tab ? "2px solid var(--accent)" : "2px solid transparent",
                padding: "2px 4px",
              }}
            >
              {label}
            </Link>
          ))}
        </div>
      </nav>

      {sp.lifecycle ? (
        <div className="card"><div className="eyebrow">LIFECYCLE</div><span className="ok-text">Machine moved to {sp.lifecycle}. Logged in the timeline.</span></div>
      ) : null}
      {sp.error ? <div className="card"><div className="eyebrow">NOT SAVED</div><span className="error-text">{sp.error}</span></div> : null}

      {/* ----------------------------- OVERVIEW ----------------------------- */}
      {tab === "overview" ? (
        <>
          <div className="card">
            <div className="eyebrow">IDENTITY</div>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <tbody>
                {[
                  ["Tag", machine.tag],
                  ["Name", machine.name],
                  ["Category", machine.category],
                  ["Make / model", [machine.make, machine.model].filter(Boolean).join(" ") || "—"],
                  ["Serial", machine.serialNumber ?? "—"],
                  ["Criticality", machine.criticality],
                  ["Site", siteName ?? "unassigned"],
                  ["Location note", machine.locationNote ?? "—"],
                  ["Install date", machine.installDate ?? "—"],
                  ["Warranty until", machine.warrantyUntil ?? "—"],
                  ["Runtime hours (base)", machine.runtimeHours],
                  ["Updated", formatDateTime(machine.updatedAt, ctx.timezone)],
                ].map(([k, v]) => (
                  <tr key={String(k)}>
                    <td style={{ color: "var(--dim2)", padding: "4px 12px 4px 0", width: 160 }}>{k}</td>
                    <td style={{ padding: "4px 0" }}>{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {Object.keys((machine.ratedSpecs as Record<string, unknown>) ?? {}).length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <div className="eyebrow">RATED SPECS</div>
                <div className="row" style={{ flexWrap: "wrap", gap: 16 }}>
                  {Object.entries((machine.ratedSpecs as Record<string, unknown>)).map(([k, v]) => (
                    <span key={k} style={{ fontSize: 11 }}>{k}: <strong>{String(v)}</strong></span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="card">
            <div className="eyebrow">VIDE DEVICES</div>
            {linkedNames.length === 0 ? (
              <p className="empty-state" style={{ margin: 0 }}>No VIDE device linked. Health/Energy tabs come alive once a device is linked (edit the machine).</p>
            ) : (
              <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
                {devices.filter((d) => d.unlinkedAt === null).map((d) => (
                  <span key={d.id} style={{ fontSize: 12 }}>● {d.videMachineName}</span>
                ))}
              </div>
            )}
          </div>

          {mayPlan ? (
            <div className="card">
              <div className="eyebrow">LIFECYCLE ACTIONS</div>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {machine.lifecycleStatus === "commissioned" ? (
                  <form action={transitionLifecycleAction}>
                    <input type="hidden" name="machineId" value={machine.id} />
                    <input type="hidden" name="to" value="active" />
                    <button type="submit">PUT INTO SERVICE</button>
                  </form>
                ) : null}
                {machine.lifecycleStatus === "active" ? (
                  <>
                    <form action={transitionLifecycleAction}>
                      <input type="hidden" name="machineId" value={machine.id} />
                      <input type="hidden" name="to" value="standby" />
                      <button type="submit" className="secondary">SET STANDBY</button>
                    </form>
                    <form action={transitionLifecycleAction}>
                      <input type="hidden" name="machineId" value={machine.id} />
                      <input type="hidden" name="to" value="standby" />
                      <input type="hidden" name="reason" value="Opening an under-maintenance window from profile" />
                      <button type="submit" className="secondary" title="Maintenance windows are normally opened by work orders (M2)">OPEN MAINTENANCE WINDOW</button>
                    </form>
                  </>
                ) : null}
                {machine.lifecycleStatus === "standby" ? (
                  <form action={transitionLifecycleAction}>
                    <input type="hidden" name="machineId" value={machine.id} />
                    <input type="hidden" name="to" value="active" />
                    <button type="submit">REACTIVATE SERVICE</button>
                  </form>
                ) : null}
                {machine.lifecycleStatus === "under_maintenance" ? (
                  <form action={transitionLifecycleAction}>
                    <input type="hidden" name="machineId" value={machine.id} />
                    <input type="hidden" name="to" value="active" />
                    <button type="submit">CLOSE MAINTENANCE WINDOW</button>
                  </form>
                ) : null}
                {machine.lifecycleStatus === "decommissioned" ? (
                  <form action={transitionLifecycleAction}>
                    <input type="hidden" name="machineId" value={machine.id} />
                    <input type="hidden" name="to" value="active" />
                    <input type="hidden" name="reason" value="Reactivated from decommissioned state" />
                    <button type="submit">REACTIVATE MACHINE</button>
                  </form>
                ) : null}
                {mayDecommission && machine.lifecycleStatus !== "decommissioned" ? (
                  <Link href={`/machines/${machine.id}/decommission`} style={{ textDecoration: "none" }}>
                    <button type="button" className="secondary">DECOMMISSION…</button>
                  </Link>
                ) : null}
                <Link href={`/machines/${machine.id}/edit`} style={{ textDecoration: "none" }}>
                  <button type="button" className="secondary">EDIT</button>
                </Link>
              </div>
              <p style={{ fontSize: 11, color: "var(--dim2)", margin: "8px 0 0" }}>
                Decommission and reactivate notify VIDE over the lifecycle notice endpoint; the acknowledgement is stamped on the timeline entry.
              </p>
            </div>
          ) : null}
        </>
      ) : null}

      {/* ------------------------------ HEALTH ------------------------------ */}
      {tab === "health" ? <HealthTab health={await loadHealth(ctx, videName)} videName={videName} /> : null}

      {/* ------------------------------ ENERGY ------------------------------ */}
      {tab === "energy" ? <EnergyTab energy={await loadEnergy(ctx, videName)} videName={videName} /> : null}

      {/* ------------------------------ NOTES ------------------------------- */}
      {tab === "notes" ? (
        <NotesTab
          notes={await loadNotes(ctx, machine.id)}
          machineId={machine.id}
          mayPlan={mayPlan}
          viewerId={ctx.userId}
          flags={{ note: sp.note, noteError: sp.note_error }}
        />
      ) : null}

      {/* ---------------------------- MAINTENANCE --------------------------- */}
      {tab === "maintenance" ? (
        <MaintenanceTab
          history={await loadHistory(ctx, machine.id)}
          machineId={machine.id}
          mayPlan={mayPlan}
          currency={ctx.currency}
          flags={{ expense: sp.expense, expenseError: sp.expense_error }}
        />
      ) : null}

      {/* ------------------------------- PARTS ------------------------------ */}
      {tab === "parts" ? (
        <PartsTab
          parts={await loadParts(ctx, machine.id)}
          machineId={machine.id}
          mayPlan={mayPlan}
          flags={{ grid: sp.grid, gridError: sp.grid_error, updated: sp.updated, added: sp.added, removed: sp.removed }}
        />
      ) : null}

      {/* ----------------------------- DOCUMENTS ---------------------------- */}
      {tab === "documents" ? (
        <DocumentsTab
          docs={await loadDocs(ctx, machine.id)}
          machineId={machine.id}
          mayPlan={mayPlan}
          flags={{ uploaded: sp.uploaded, deleted: sp.deleted }}
        />
      ) : null}

      {/* ------------------------------ FAULTS ------------------------------ */}
      {tab === "faults" ? <FaultsTab faults={await loadFaults(ctx, machine.id)} videName={videName} /> : null}

      {/* ----------------------------- TIMELINE ----------------------------- */}
      {tab === "timeline" ? (
        <div className="card">
          <div className="eyebrow">{`TIMELINE / ${lifeCount.length} ENTRIES`}</div>
          {lifeCount.length === 0 ? (
            <p className="empty-state" style={{ margin: 0 }}>Nothing recorded yet.</p>
          ) : (
            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
              <tbody>
                {lifeCount.map((e, i) => (
                  <tr key={i}>
                    <td style={{ color: "var(--dim2)", whiteSpace: "nowrap", padding: "4px 10px 4px 0", width: 150 }}>{formatDateTime(e.at, ctx.timezone)}</td>
                    <td style={{ padding: "4px 8px 4px 0" }}>{e.label}</td>
                    <td style={{ color: "var(--dim2)" }}>{e.detail ?? ""}</td>
                    <td style={{ color: e.videStatus === "acknowledged" ? "var(--ok)" : e.videStatus === "failed" ? "var(--danger)" : "var(--dim2)", width: 90 }}>{e.videStatus ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </>
  );
}

/* --------------------------- tab components --------------------------- */

function HealthTab({ health, videName }: { health: HealthView | null; videName: string | null }) {
  if (!videName) {
    return <div className="card"><div className="eyebrow">HEALTH</div><p className="empty-state" style={{ margin: 0 }}>Link a VIDE device to see live health.</p></div>;
  }
  if (!health) return null;
  if (!health.ok) {
    return <div className="card"><div className="eyebrow">HEALTH</div><span className="error-text">VIDE health endpoint: {health.message}</span></div>;
  }
  const verts = health.samples.map((s, i) => `${(i * 10).toFixed(1)},${(100 - s.score).toFixed(1)}`).join(" ");
  return (
    <div className="card">
      <div className="eyebrow">HEALTH — LAST 7 DAYS (VIDE)</div>
      <div className="row" style={{ alignItems: "baseline", gap: 20 }}>
        <div>
          <div style={{ fontSize: 42, fontWeight: 800, color: health.score >= 75 ? "var(--ok)" : health.score >= 50 ? "var(--warn)" : "var(--danger)" }}>{health.score}</div>
          <div style={{ fontSize: 11, color: "var(--dim2)" }}>{health.status} · as of {formatDateTime(health.asOf)}</div>
        </div>
        {health.samples.length > 1 ? (
          <svg viewBox="0 0 100 100" width={220} height={80} preserveAspectRatio="none" aria-label="health trend sparkline">
            <polyline points={verts} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
          </svg>
        ) : null}
      </div>
      <p style={{ fontSize: 11, color: "var(--dim2)", margin: "10px 0 0" }}>
        Source: getMachineHealthSummary for {videName} (PROPOSED endpoint; mock data until VIDE ships it. Never a report number.)
      </p>
    </div>
  );
}

function EnergyTab({ energy, videName }: { energy: EnergyView | null; videName: string | null }) {
  if (!videName) {
    return <div className="card"><div className="eyebrow">ENERGY</div><p className="empty-state" style={{ margin: 0 }}>Link a VIDE device to see energy.</p></div>;
  }
  if (!energy) return null;
  if (!energy.ok) {
    return <div className="card"><div className="eyebrow">ENERGY</div><span className="error-text">VIDE energy endpoint: {energy.message}</span></div>;
  }
  const maxKwh = Math.max(0.001, ...energy.buckets.map((b) => b.kwh));
  return (
    <div className="card">
      <div className="eyebrow">ENERGY — LAST 7 DAYS (kWh / day, VIDE)</div>
      {energy.buckets.length === 0 ? (
        <p className="empty-state" style={{ margin: 0 }}>No buckets returned.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {energy.buckets.map((b) => (
            <div key={b.at} className="row" style={{ gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: "var(--dim2)", width: 110 }}>{formatDateTime(b.at).slice(0, 6)}</span>
              <div style={{ background: "var(--line3)", height: 14, width: 200 * (b.kwh / maxKwh), maxWidth: "60%" }} />
              <span style={{ fontSize: 11 }}>{b.kwh.toFixed(1)} kWh</span>
            </div>
          ))}
        </div>
      )}
      {energy.events.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow">POWER QUALITY EVENTS</div>
          {energy.events.map((e, i) => (
            <div key={i} style={{ fontSize: 11 }}>
              <span className="error-text">{e.eventType}</span> — {formatDateTime(e.at)} {e.detail ?? ""}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const WO_STATUS_COLOR: Record<string, string> = {
  completed: "var(--ok)", verified: "var(--ok)", closed: "var(--ok)",
  cancelled: "var(--danger)", in_progress: "var(--warn)", on_hold: "var(--warn)",
};

function MaintenanceTab({
  history,
  machineId,
  mayPlan,
  currency,
  flags,
}: {
  history: Awaited<ReturnType<typeof maintenanceHistoryService.forMachine>>;
  machineId: string;
  mayPlan: boolean;
  currency: string;
  flags: { expense?: string; expenseError?: string };
}) {
  const s = history.summary;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      {flags.expense === "added" ? (
        <div className="card"><span className="ok-text">Expenditure logged — the machine's money story is up to date.</span></div>
      ) : null}
      {flags.expense === "removed" ? (
        <div className="card"><span className="ok-text">Entry removed (audited). To correct an amount, log a fresh entry.</span></div>
      ) : null}
      {flags.expenseError ? (
        <div className="card"><div className="eyebrow">EXPENDITURE NOT SAVED</div><span className="error-text">{flags.expenseError}</span></div>
      ) : null}

      {/* profile v2 header stats — the machine's money story at a glance */}
      <div className="card">
        <div className="eyebrow">MACHINE STORY</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 24 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--dim2)", letterSpacing: 1 }}>LAST SERVICE</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              {s.lastServiceAt ? formatDateTime(s.lastServiceAt) : "never concluded"}
            </div>
            {s.lastServiceWoNumber ? (
              <div style={{ fontSize: 11, color: "var(--dim2)" }}>{s.lastServiceWoNumber}</div>
            ) : null}
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--dim2)", letterSpacing: 1 }}>WORK ORDERS</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              {s.openWorkOrders} open · {s.concludedWorkOrders} done
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--dim2)", letterSpacing: 1 }}>SPEND — LAST 12 MONTHS</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--warn)" }}>{formatKobo(s.last365dKobo, currency)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--dim2)", letterSpacing: 1 }}>LIFETIME SPEND</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{formatKobo(s.totalKobo, currency)}</div>
            <div style={{ fontSize: 10, color: "var(--dim2)" }}>
              WO labor {formatKobo(s.laborKobo, currency)} + parts {formatKobo(s.partsKobo, currency)} + logged {formatKobo(s.manualKobo, currency)}
            </div>
          </div>
        </div>
      </div>

      {/* maintenance history — every work order that ever touched this machine */}
      <div className="card">
        <div className="eyebrow">{`MAINTENANCE HISTORY / ${history.rows.length}`}</div>
        {history.rows.length === 0 ? (
          <p className="empty-state" style={{ margin: 0 }}>
            No work orders yet. Create one from WORK ORDERS (machine link attaches its full history here automatically).
          </p>
        ) : (
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["WO", "TITLE", "TYPE", "STATUS", "FINISHED", "DOWNTIME", "COST"].map((h) => (
                  <th key={h} style={{ textAlign: "left", fontSize: 10, color: "var(--dim2)", padding: "2px 10px 6px 0", letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.rows.map((r) => (
                <tr key={r.wo.id}>
                  <td style={{ padding: "4px 10px 4px 0", whiteSpace: "nowrap" }}>
                    <Link href={`/work-orders/${r.wo.id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{r.wo.number}</Link>
                  </td>
                  <td style={{ padding: "4px 10px 4px 0" }}>{r.wo.title}</td>
                  <td style={{ color: "var(--dim2)", width: 100 }}>{r.wo.type}</td>
                  <td style={{ width: 110, color: WO_STATUS_COLOR[r.wo.status] ?? "var(--dim2)" }}>{r.wo.status}</td>
                  <td style={{ color: "var(--dim2)", width: 140 }}>{r.finishedAt ? formatDateTime(r.finishedAt) : "—"}</td>
                  <td style={{ color: "var(--dim2)", width: 80 }}>{r.wo.downtimeHours != null ? `${Number(r.wo.downtimeHours).toFixed(1)} h` : "—"}</td>
                  <td style={{ width: 110 }}>{r.costKobo > 0 ? formatKobo(r.costKobo, currency) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: 10, color: "var(--dim2)", margin: "10px 0 0" }}>
          Cost = labor (Σ logged hours × rate) + issued parts at their issue-time unit cost. Rolled up from the work-order ledger — never hand-typed.
        </p>
      </div>

      {/* expenditure logbook — the spend that bypasses work orders */}
      <div className="card">
        <div className="eyebrow">{`EXPENDITURE LOG / ${history.expenses.length}`}</div>
        {history.expenses.length === 0 ? (
          <p className="empty-state" style={{ margin: 0 }}>
            No logged spend. Record cash service, fuel, hire, consumables, subcontractor invoices — everything a work order never captured.
          </p>
        ) : (
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["DATE", "KIND", "DESCRIPTION", "VENDOR / REF", "AMOUNT", ""].map((h, i) => (
                  <th key={`${h}-${i}`} style={{ textAlign: "left", fontSize: 10, color: "var(--dim2)", padding: "2px 10px 6px 0", letterSpacing: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.expenses.map((e) => (
                <tr key={e.id}>
                  <td style={{ padding: "4px 10px 4px 0", color: "var(--dim2)", whiteSpace: "nowrap", width: 120 }}>{formatDateTime(e.occurredAt, "Africa/Lagos").slice(0, 10)}</td>
                  <td style={{ color: "var(--dim2)", width: 110 }}>{e.kind.replace(/_/g, " ")}</td>
                  <td style={{ padding: "4px 10px 4px 0" }}>{e.description}</td>
                  <td style={{ color: "var(--dim2)" }}>{[e.vendor, e.reference].filter(Boolean).join(" · ") || "—"}</td>
                  <td style={{ width: 120, fontWeight: 600 }}>{formatKobo(e.amountKobo, currency)}</td>
                  <td style={{ width: 46 }}>
                    {mayPlan ? (
                      <form action={deleteMachineExpenseAction}>
                        <input type="hidden" name="machineId" value={machineId} />
                        <input type="hidden" name="expenseId" value={e.id} />
                        <button type="submit" className="secondary" style={{ fontSize: 9, padding: "2px 6px" }}>DEL</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {mayPlan ? (
        <form action={addMachineExpenseAction} className="card">
          <input type="hidden" name="machineId" value={machineId} />
          <div className="eyebrow">LOG EXPENDITURE</div>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <input type="date" name="occurredAt" defaultValue={today} style={{ maxWidth: 150 }} />
            <select name="kind" defaultValue="other" style={{ maxWidth: 160 }}>
              {["service", "contract", "parts_direct", "consumable", "fuel", "hire", "calibration", "training", "other"].map((k) => (
                <option key={k} value={k}>{k.replace(/_/g, " ")}</option>
              ))}
            </select>
            <input name="description" placeholder="What was bought — e.g. bearing repack LRS" required style={{ flex: 1, minWidth: 220 }} />
            <input name="amount" type="number" step="0.01" min="0.01" placeholder="Amount ₦" required style={{ maxWidth: 140 }} />
            <input name="vendor" placeholder="Vendor (optional)" style={{ maxWidth: 160 }} />
            <input name="reference" placeholder="Invoice / receipt № (optional)" style={{ maxWidth: 190 }} />
            <button type="submit">LOG</button>
          </div>
          <p style={{ fontSize: 10, color: "var(--dim2)", margin: "8px 0 0" }}>
            Append-only: corrections delete the entry (audited) and re-log it. Work-order labor and parts costs roll up automatically — log only the spend that bypassed a work order.
          </p>
        </form>
      ) : null}
    </>
  );
}

/** note-body → HTML (server-rendered markdown, escape-first). */
function NoteBody({ body }: { body: string }) {
  const html = renderMarkdown(body);
  return (
    <div
      className="md-note"
      style={{ fontSize: 12, lineHeight: 1.7 }}
      // markdown renderer escapes everything first and emits only whitelisted tags
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function NotesTab({
  notes,
  machineId,
  mayPlan,
  viewerId,
  flags,
}: {
  notes: Awaited<ReturnType<typeof notesService.list>>;
  machineId: string;
  mayPlan: boolean;
  viewerId: string;
  flags: { note?: string; noteError?: string };
}) {
  return (
    <>
      {flags.note === "added" ? <div className="card"><span className="ok-text">Note saved.</span></div> : null}
      {flags.note === "edited" ? <div className="card"><span className="ok-text">Note edited (audited).</span></div> : null}
      {flags.note === "imported" ? (
        <div className="card"><span className="ok-text">File imported — original stored on the ATTACHMENTS tab, note below.</span></div>
      ) : null}
      {flags.note === "removed" ? <div className="card"><span className="ok-text">Note removed (audited).</span></div> : null}
      {flags.noteError ? (
        <div className="card"><div className="eyebrow">NOTE NOT SAVED</div><span className="error-text">{flags.noteError}</span></div>
      ) : null}

      <div className="card">
        <div className="eyebrow">{`KNOWLEDGE / ${notes.length}`}</div>
        {notes.length === 0 ? (
          <p className="empty-state" style={{ margin: 0 }}>
            No notes yet. Write run-notes in Markdown, or import .md / .txt / .csv / .xlsx — spreadsheets come in as row-capped tables, the original file always stays on ATTACHMENTS.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {notes.map((n) => (
              <div key={n.id} id={`note-${n.id}`} style={{ borderBottom: "1px solid var(--line3)", paddingBottom: 10, scrollMarginTop: 12 }}>
                <div className="row" style={{ alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <div>
                    <strong style={{ fontSize: 13 }}>{n.title}</strong>
                    <span style={{ fontSize: 10, color: "var(--dim2)", marginLeft: 8 }}>
                      {n.source === "typed" ? "typed" : n.source} · {formatDateTime(n.createdAt)}
                      {n.updatedAt > n.createdAt ? <> · edited</> : null}
                      {n.documentId ? <> · <Link href={`/machines/${machineId}/docs/${n.documentId}`} style={{ color: "var(--accent)", textDecoration: "none" }}>ORIGINAL FILE</Link></> : null}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    {mayPlan || viewerId === n.createdBy ? (
                      <details>
                        <summary style={{ fontSize: 9, color: "var(--accent)", cursor: "pointer", letterSpacing: 1, listStyle: "none" }}>EDIT</summary>
                        <form action={editMachineNoteAction} style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6, minWidth: 260 }}>
                          <input type="hidden" name="machineId" value={machineId} />
                          <input type="hidden" name="noteId" value={n.id} />
                          <input name="title" defaultValue={n.title} aria-label="Note title" style={{ width: "100%" }} />
                          <textarea name="body" rows={5} defaultValue={n.body} aria-label="Note body" style={{ width: "100%", fontFamily: "inherit", fontSize: 12 }} />
                          <button type="submit" style={{ fontSize: 10, padding: "4px 10px" }}>SAVE NOTE</button>
                        </form>
                      </details>
                    ) : null}
                    {mayPlan ? (
                      <form action={deleteMachineNoteAction}>
                        <input type="hidden" name="machineId" value={machineId} />
                        <input type="hidden" name="noteId" value={n.id} />
                        <button type="submit" className="secondary" style={{ fontSize: 9, padding: "2px 6px" }}>DEL</button>
                      </form>
                    ) : null}
                  </div>
                </div>
                <div style={{ marginTop: 6 }}>
                  <NoteBody body={n.body} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <form action={addMachineNoteAction} className="card">
        <input type="hidden" name="machineId" value={machineId} />
        <div className="eyebrow">WRITE NOTE (MARKDOWN)</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <input name="title" placeholder="Title — e.g. PM findings Q3" style={{ flex: 1, minWidth: 240 }} />
        </div>
        <textarea
          name="body"
          rows={7}
          placeholder={"## What happened\n- seal leak at drive end\n- replaced, tested **10 min dry run**\n\n# headings, - lists, **bold**, `code`, links"}
          required
          style={{ width: "100%", minHeight: 140, fontSize: 12 }}
        />
        <div style={{ marginTop: 8 }}>
          <button type="submit">SAVE NOTE</button>
        </div>
      </form>

      <form action={importMachineNoteAction} className="card">
        <input type="hidden" name="machineId" value={machineId} />
        <div className="eyebrow">IMPORT AS NOTE (max 5 MB · .md / .txt / .csv / .xlsx)</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <input type="file" name="file" required />
          <button type="submit">IMPORT</button>
        </div>
        <p style={{ fontSize: 10, color: "var(--dim2)", margin: "8px 0 0" }}>
          MD/TXT land verbatim; CSV/XLSX come in as the first 100 rows as a table (original always kept). PDF/DOCX belong on the ATTACHMENTS tab — preview there, download to view.
        </p>
      </form>
    </>
  );
}

function PartsTab({
  parts,
  machineId,
  mayPlan,
  flags,
}: {
  parts: Awaited<ReturnType<typeof componentsService.listForMachine>>;
  machineId: string;
  mayPlan: boolean;
  flags: { grid?: string; gridError?: string; updated?: string; added?: string; removed?: string };
}) {
  return (
    <>
      {flags.grid === "saved" ? (
        <div className="card">
          <span className="ok-text">
            Grid saved — {flags.updated ?? "0"} updated · {flags.added ?? "0"} added · {flags.removed ?? "0"} removed (each audited).
          </span>
        </div>
      ) : null}
      {flags.gridError ? (
        <div className="card"><span className="error-text">{flags.gridError}</span></div>
      ) : null}
      {!mayPlan ? (
        <div className="card">
          <div className="eyebrow">{`COMPONENTS / ${parts.length}`}</div>
          {parts.length === 0 ? (
            <p className="empty-state" style={{ margin: 0 }}>No components recorded. Add bearing housings, seals, drive belts — linked inventory items arrive in M3.</p>
          ) : (
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <tbody>
                {parts.map((p) => (
                  <tr key={p.id}>
                    <td style={{ padding: "4px 10px 4px 0" }}>{p.tag ? <>{p.tag} · </> : null}{p.name}</td>
                    <td style={{ color: "var(--dim2)", width: 120 }}>{p.kind}</td>
                    <td style={{ color: "var(--dim2)" }}>{p.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <form action={saveComponentGridAction} className="card">
          <input type="hidden" name="machineId" value={machineId} />
          <div className="eyebrow">{`COMPONENTS GRID / ${parts.length} + 3 ADD ROWS`}</div>
          <p style={{ fontSize: 12, color: "var(--dim)", margin: "4px 0 10px" }}>
            Edit names, tags, kinds and notes in place; tick DEL to remove a row; use the empty bottom rows to add
            components. One SAVE GRID commits everything.
          </p>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--dim2)", textAlign: "left" }}>
                <th style={{ padding: "4px 8px 4px 0" }}>NAME</th>
                <th style={{ padding: "4px 8px 4px 0", width: 110 }}>TAG</th>
                <th style={{ padding: "4px 8px 4px 0", width: 150 }}>KIND</th>
                <th style={{ padding: "4px 8px 4px 0" }}>NOTE</th>
                <th style={{ padding: "4px 0", width: 30 }}>DEL</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p, i) => (
                <tr key={p.id}>
                  <td style={{ padding: "2px 8px 2px 0" }}>
                    <input type="hidden" name="comp_id" value={p.id} />
                    <input name="comp_name" defaultValue={p.name} required maxLength={120} style={{ width: "100%", textTransform: "none" }} />
                  </td>
                  <td style={{ padding: "2px 8px 2px 0" }}>
                    <input name="comp_tag" defaultValue={p.tag ?? ""} maxLength={40} style={{ width: "100%" }} />
                  </td>
                  <td style={{ padding: "2px 8px 2px 0" }}>
                    <select name="comp_kind" defaultValue={p.kind} style={{ width: "100%" }}>
                      {[...new Set([p.kind, ...COMPONENT_KINDS])].map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "2px 8px 2px 0" }}>
                    <input name="comp_note" defaultValue={p.note ?? ""} maxLength={300} style={{ width: "100%" }} />
                  </td>
                  <td style={{ padding: 0, textAlign: "center" }}>
                    <input type="checkbox" name={`comp_remove_${i}`} value="1" />
                  </td>
                </tr>
              ))}
              {[0, 1, 2].map(() => (
                <tr key={`add-${machineId}`}>
                  <td style={{ padding: "2px 8px 2px 0" }}>
                    <input type="hidden" name="comp_id" value="" />
                    <input name="comp_name" placeholder="new component — e.g. Drive-end bearing" maxLength={120} style={{ width: "100%" }} />
                  </td>
                  <td style={{ padding: "2px 8px 2px 0" }}>
                    <input name="comp_tag" placeholder="tag" maxLength={40} style={{ width: "100%" }} />
                  </td>
                  <td style={{ padding: "2px 8px 2px 0" }}>
                    <select name="comp_kind" style={{ width: "100%" }}>
                      {COMPONENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: "2px 8px 2px 0" }}>
                    <input name="comp_note" placeholder="note" maxLength={300} style={{ width: "100%" }} />
                  </td>
                  <td style={{ padding: 0 }} />
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="submit">SAVE GRID</button>
          </div>
        </form>
      )}
    </>
  );
}

function DocumentsTab({
  docs,
  machineId,
  mayPlan,
  flags,
}: {
  docs: Awaited<ReturnType<typeof documentsService.listForMachine>>;
  machineId: string;
  mayPlan: boolean;
  flags: { uploaded?: string; deleted?: string };
}) {
  return (
    <>
      {flags.uploaded ? <div className="card"><span className="ok-text">Document stored. Scan status: unscanned until a scanner is wired.</span></div> : null}
      {flags.deleted ? <div className="card"><span className="ok-text">Document removed (soft delete, audited).</span></div> : null}
      <div className="card">
        <div className="eyebrow">{`DOCUMENTS / ${docs.length}`}</div>
        {docs.length === 0 ? (
          <p className="empty-state" style={{ margin: 0 }}>No documents. Manuals, datasheets, calibration certs and photos live here — stored in the DB for the demo (S3 adapter later).</p>
        ) : (
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td style={{ padding: "5px 10px 5px 0" }}>{d.name}</td>
                  <td style={{ color: "var(--dim2)", width: 110 }}>{d.kind}</td>
                  <td style={{ color: "var(--dim2)", width: 90 }}>{Math.round(d.sizeBytes / 1024)} KB</td>
                  <td style={{ color: d.scanStatus === "quarantined" ? "var(--danger)" : "var(--dim2)", width: 100 }}>{d.scanStatus}</td>
                  <td style={{ width: 130 }}>
                    <a href={`/machines/${machineId}/docs/${d.id}`} style={{ color: "var(--accent)", fontSize: 11, marginRight: 10 }}>PREVIEW</a>
                    <a href={`/api/documents/${d.id}`} style={{ color: "var(--accent)", fontSize: 11 }}>OPEN</a>
                  </td>
                  {mayPlan ? (
                    <td style={{ width: 70 }}>
                      <form action={deleteDocumentAction}>
                        <input type="hidden" name="machineId" value={machineId} />
                        <input type="hidden" name="documentId" value={d.id} />
                        <button type="submit" className="secondary" style={{ fontSize: 9, padding: "2px 6px" }}>DEL</button>
                      </form>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <form action={uploadDocumentAction} className="card">
        <input type="hidden" name="machineId" value={machineId} />
        <div className="eyebrow">UPLOAD (max 5 MB · png/jpeg/webp/pdf/text)</div>
        <div className="row">
          <input type="file" name="file" required />
          <select name="kind" defaultValue="other">
            {["manual", "datasheet", "drawing", "photo", "procedure", "warranty", "calibration_cert", "report", "other"].map((k) => (
              <option key={k} value={k}>{k.replace(/_/g, " ")}</option>
            ))}
          </select>
          <button type="submit">UPLOAD</button>
        </div>
      </form>
    </>
  );
}

function FaultsTab({
  faults,
  videName,
}: {
  faults: Awaited<ReturnType<typeof loadFaultsType>> | null;
  videName: string | null;
}) {
  if (!videName) {
    return <div className="card"><div className="eyebrow">FAULTS</div><p className="empty-state" style={{ margin: 0 }}>Link a VIDE device to receive faults.</p></div>;
  }
  if (!faults || faults.length === 0) {
    return (
      <div className="card">
        <div className="eyebrow">FAULTS</div>
        <p className="empty-state" style={{ margin: 0 }}>No faults pushed for {videName} yet — the VIDE webhook writes them here by device name.</p>
      </div>
    );
  }
  const SEV_CLASS: Record<string, string> = { critical: "urgency-high", warning: "urgency-medium", watch: "" };
  return (
    <div className="card">
      <div className="eyebrow">{`FAULTS / ${faults.length}`}</div>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <tbody>
          {faults.map((f) => (
            <tr key={f.id}>
              <td style={{ padding: "4px 10px 4px 0", width: 150, color: "var(--dim2)", fontSize: 11 }}>{formatDateTime(f.flaggedAt)}</td>
              <td style={{ padding: "4px 8px 4px 0" }}><span className={SEV_CLASS[f.severity] ?? ""}>{f.faultType}</span></td>
              <td style={{ color: "var(--dim2)" }}>{f.description ?? ""}</td>
              <td style={{ padding: "4px 0 4px 8px", fontSize: 10, color: "var(--dim2)", whiteSpace: "nowrap" }}>
                {f.status}
                {f.woNumber ? <> · <Link href={`/work-orders/${f.woId}`} style={{ color: "var(--accent)", textDecoration: "none" }}>{f.woNumber}</Link></> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type FaultRow = {
  id: string; machineId: string | null; videMachineName: string; faultType: string;
  severity: string; description: string | null; flaggedAt: Date; status: string;
  woId: string | null; woNumber: string | null;
};
async function loadFaultsType(): Promise<FaultRow[]> {
  throw new Error("never called — typing helper only");
}
