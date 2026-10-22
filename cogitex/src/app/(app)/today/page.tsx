import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getCtx } from "@/server/ctx";
import { getIntegrations } from "@/lib/integrations/factory";
import { greeting } from "@/lib/time";
import { getDb } from "@/server/db/client";
import { machines, workOrders } from "@/server/db/schema";
import { faultsService } from "@/server/services/faults";
import { inventoryService } from "@/server/services/inventory";
import { machinesService } from "@/server/services/machines";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

const OPEN_WO = ["draft", "planned", "assigned", "in_progress", "on_hold"] as const;

/**
 * "What needs attention today" — the live home view. Every number comes from this org's
 * records (machines/faults/work orders/inventory) or the VIDE integration heartbeat via
 * the configured adapter; nothing is placeholder anymore.
 */
export default async function TodayPage() {
  const ctx = await getCtx();
  if (!ctx) return null; // (app) layout already redirected unauthenticated users

  const now = new Date();
  const horizon = new Date(now.getTime() + 7 * 86_400_000);
  const integrations = getIntegrations();

  const [machineRows, openFaults, lowStock, db] = await Promise.all([
    machinesService.list(ctx),
    faultsService.list(ctx, { status: "open" }),
    inventoryService.list(ctx, { lowOnly: true }),
    getDb(),
  ]);

  // Open work orders, soonest planned end first (nulls last so "unscheduled" never hides due ones).
  const openWoRows = await db
    .select({
      id: workOrders.id,
      number: workOrders.number,
      title: workOrders.title,
      status: workOrders.status,
      priority: workOrders.priority,
      plannedEnd: workOrders.plannedEnd,
      tag: machines.tag,
    })
    .from(workOrders)
    .leftJoin(machines, eq(machines.id, workOrders.machineId))
    .where(and(eq(workOrders.organizationId, ctx.orgId), inArray(workOrders.status, [...OPEN_WO])))
    .orderBy(sql`${workOrders.plannedEnd} nulls last`, asc(workOrders.plannedEnd))
    .limit(30);

  const fleetActive = machineRows.filter((m) => m.lifecycleStatus !== "decommissioned").length;
  const faultCounts = {
    critical: openFaults.filter((f) => f.severity === "critical").length,
    warning: openFaults.filter((f) => f.severity === "warning").length,
  };
  const dueThisWeek = openWoRows.filter((w) => w.plannedEnd !== null && w.plannedEnd <= horizon);

  // Health-tinted stat tiles: border/value color reflects live state.
  const fleetState = faultCounts.critical > 0 ? "crit" : faultCounts.warning > 0 ? "warn" : "ok";
  const faultsState = faultCounts.critical > 0 ? "crit" : faultCounts.warning > 0 ? "warn" : "ok";
  const dueState = dueThisWeek.length > 0 ? "warn" : "ok";
  const stockState = lowStock.length > 0 ? "warn" : "ok";

  const stateStyle: Record<"ok" | "warn" | "crit", { border: string; value: string }> = {
    ok:   { border: "var(--line)", value: "var(--ink)" },
    warn: { border: "var(--warn-line)", value: "var(--warn)" },
    crit: { border: "var(--crit-line)", value: "var(--crit)" },
  };

  // VIDE heartbeat — best effort; a dead VIDE must never take this page down.
  type Heartbeat = { status?: string; mode?: string; factory?: { name?: string } } | null;
  let health: Heartbeat = null;
  try {
    health = (await integrations.vide.getDetailedHealth()) as Heartbeat;
  } catch {
    health = null;
  }
  const videState =
    integrations.profile === "real"
      ? health
        ? health.mode === "disabled"
          ? { label: "VIDE LIVE · SIM OFF", tone: "dim" }
          : { label: "VIDE LIVE", tone: "ok" }
        : { label: "VIDE LIVE · unreachable", tone: "warn" }
      : { label: "MOCK ADAPTERS", tone: "dim" };

  // ---- attention queue: worst faults first, then due work orders, then low stock
  const sevRank: Record<string, number> = { critical: 0, warning: 1, watch: 2 };
  const queue: { kind: string; href: string; text: string }[] = [];
  for (const f of [...openFaults].sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9)).slice(0, 4)) {
    queue.push({
      kind: "FAULT",
      href: `/faults`,
      text: `${f.videMachineName ?? "machine"} — ${f.faultType} (${f.severity}) flagged ${new Date(f.flaggedAt).toLocaleDateString()}`,
    });
  }
  for (const w of dueThisWeek.slice(0, 2)) {
    queue.push({
      kind: "WO",
      href: `/work-orders`,
      text: `${w.number} due ${w.plannedEnd ? new Date(w.plannedEnd).toLocaleDateString() : "soon"} — ${w.title}`,
    });
  }
  for (const it of lowStock.slice(0, 2)) {
    queue.push({
      kind: "STOCK",
      href: `/inventory`,
      text: `${it.sku} — ${it.name} at/below reorder point (${Number(it.qtyOnHand)} ${it.unit} on hand)`,
    });
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <div
          className="avatar"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            display: "grid",
            placeItems: "center",
            background: "linear-gradient(135deg, var(--grad1), var(--grad2))",
            color: "var(--on-accent, #fff)",
            fontWeight: 800,
            fontSize: 13,
            flexShrink: 0,
          }}
        >
          {ctx.name.trim().split(/\s+/).map((p) => p[0]).join("").toUpperCase().slice(0, 2) || "M"}
        </div>
        <div>
          <h1>{`Good ${greeting(now, ctx.timezone)}, ${ctx.name.split(" ")[0] ?? ctx.name}`}</h1>
          <p className="lead">{`What needs attention today — ${ctx.orgName}`}</p>
        </div>
      </div>

      <div className="grid4">
        <div className="tile" style={{ borderColor: stateStyle[fleetState].border }}>
          <div className="label" style={{ color: stateStyle[fleetState].value === "var(--ink)" ? "var(--dim2)" : stateStyle[fleetState].value }}>
            FLEET
          </div>
          <div className="value" style={{ color: stateStyle[fleetState].value }}>{fleetActive}</div>
          <div className="sub">{`${machineRows.length} machines on the register`}</div>
        </div>
        <div className="tile" style={{ borderColor: stateStyle[faultsState].border }}>
          <div className="label" style={{ color: stateStyle[faultsState].value === "var(--ink)" ? "var(--dim2)" : stateStyle[faultsState].value }}>
            OPEN FAULTS
          </div>
          <div className="value" style={{ color: stateStyle[faultsState].value }}>{openFaults.length}</div>
          <div className="sub">{`${faultCounts.critical} critical · ${faultCounts.warning} warning`}</div>
        </div>
        <div className="tile" style={{ borderColor: stateStyle[dueState].border }}>
          <div className="label" style={{ color: stateStyle[dueState].value === "var(--ink)" ? "var(--dim2)" : stateStyle[dueState].value }}>
            DUE THIS WEEK
          </div>
          <div className="value" style={{ color: stateStyle[dueState].value }}>{dueThisWeek.length}</div>
          <div className="sub">{`${openWoRows.length} open work orders total`}</div>
        </div>
        <div className="tile" style={{ borderColor: stateStyle[stockState].border }}>
          <div className="label" style={{ color: stateStyle[stockState].value === "var(--ink)" ? "var(--dim2)" : stateStyle[stockState].value }}>
            LOW STOCK
          </div>
          <div className="value" style={{ color: stateStyle[stockState].value }}>{lowStock.length}</div>
          <div className="sub">at or below reorder point</div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="eyebrow">WHAT NEEDS ATTENTION TODAY</div>
          {queue.length === 0 ? (
            <div className="empty-state">Nothing queued — no open faults, no work orders due this week, stock healthy.</div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {queue.map((q) => (
                <li key={`${q.kind}-${q.text}`}>
                  <a className="kv" href={q.href}>
                    <span className="k mono">{q.kind}</span>
                    <span className="v">{q.text}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <div className="eyebrow">INTEGRATION STATUS</div>
          <p className="kv">
            <span className="k">VIDE</span>
            <span className="v">{videState.label}</span>
          </p>
          <p className="kv">
            <span className="k">VIDE base URL</span>
            <span className="v">{process.env.VIDE_API_BASE_URL ? "configured" : "not configured"}</span>
          </p>
          <p className="kv">
            <span className="k">Factory</span>
            <span className="v">{health?.factory?.name ?? "—"}</span>
          </p>
          <p className="kv">
            <span className="k">Notification provider</span>
            <span className="v">mock (in-app)</span>
          </p>
          <div className="demo-hint" style={{ marginTop: 10 }}>
            The SIM switch lives on the VIDE tab (SIM ON/OFF) — telemetry flows live to this workspace while it is ON.
          </div>
        </div>
      </div>
    </>
  );
}
