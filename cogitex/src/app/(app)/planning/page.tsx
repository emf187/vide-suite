import Link from "next/link";
import { transitionWorkOrderAction } from "../work-orders/actions";
import { getCtx } from "@/server/ctx";
import { can } from "@/server/policies";
import { machinesService } from "@/server/services/machines";
import { pmService, schedulesService } from "@/server/services/schedules";
import { workOrderService } from "@/server/services/work-orders";
import { formatDateTime } from "@/lib/time";
import { createScheduleAction, generatePmAction, toggleScheduleAction } from "./actions";

export const metadata = { title: "Planning" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthGrid(year: number, month0: number): (number | null)[][] {
  // Monday-first grid of a month; null = padding day of the neighbouring month.
  const first = new Date(Date.UTC(year, month0, 1));
  const startOffset = (first.getUTCDay() + 6) % 7; // Monday=0
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const cells: (number | null)[] = Array(startOffset).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; day?: string; woedit?: string; dry?: string; generated?: string; error?: string; created?: string; updated?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const sp = await searchParams;

  // Month under view (YYYY-MM), default: current month in org timezone (approx by server date).
  const now = new Date();
  const monthParam = sp.month ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [yRaw, mRaw] = monthParam.split("-");
  const y = Number(yRaw);
  const m = Number(mRaw);
  const validMonth = yRaw !== undefined && mRaw !== undefined && Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12;
  const year = validMonth ? (y as number) : now.getUTCFullYear();
  const month0 = validMonth ? (m as number) - 1 : now.getUTCMonth();
  const monthStart = new Date(Date.UTC(year, month0, 1));
  const monthEnd = new Date(Date.UTC(year, month0 + 1, 1));
  const prev = new Date(Date.UTC(year, month0 - 1, 1));
  const next = monthEnd;

  // Selected day (interactive day view): validated YYYY-MM-DD inside the viewed month.
  const dayMatch = sp.day ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(sp.day) : null;
  const selectedDay =
    dayMatch && Number(dayMatch[1]) === year && Number(dayMatch[2]) === month0 + 1
      ? sp.day!
      : null;
  const selectedDayNum = selectedDay ? Number(dayMatch![3]) : null;
  const selectedDayStart = selectedDay ? new Date(`${selectedDay}T00:00:00Z`) : null;
  const selectedDayEnd = selectedDay
    ? new Date(new Date(`${selectedDay}T00:00:00Z`).getTime() + 86_400_000)
    : null;

  const [schedules, templates, machines, recentRuns, allWos] = await Promise.all([
    schedulesService.list(ctx),
    schedulesService.templates(ctx),
    machinesService.list(ctx),
    schedulesService.recentRuns(ctx, 12),
    workOrderService.list(ctx),
  ]);

  // Calendar shows LIVE cards only — cancelled ones were "removed" from the plan.
  const monthWos = allWos.filter((wo) => {
    const ref = wo.plannedStart ?? wo.createdAt;
    return ref >= monthStart && ref < monthEnd && wo.status !== "cancelled";
  });
  const backlog = allWos.filter((wo) => ["planned", "assigned", "in_progress", "on_hold", "draft"].includes(wo.status));

  // Day → WOs map for the grid
  const byDay = new Map<number, typeof monthWos>();
  for (const wo of monthWos) {
    const ref = wo.plannedStart ?? wo.createdAt;
    if (ref.getUTCFullYear() === year && ref.getUTCMonth() === month0) {
      const d = ref.getUTCDate();
      const list = byDay.get(d) ?? [];
      list.push(wo);
      byDay.set(d, list);
    }
  }
  const weeks = monthGrid(year, month0);
  const machineTag = (id: string | null) => (id ? (machines.find((mm) => mm.id === id)?.tag ?? "—") : null);

  const machineOptions = machines.filter((mm) => mm.lifecycleStatus !== "decommissioned");

  return (
    <>
      <h1>Planning</h1>
      <p className="lead">The month at a glance, the backlog to burn down, and the PM schedules that feed it automatically.</p>

      {sp.dry ? <div className="card"><div className="eyebrow">PM DRY RUN</div><span style={{ fontSize: 12 }}>{decodeURIComponent(sp.dry)}</span></div> : null}
      {sp.generated ? <div className="card"><span className="ok-text">PM generation ran — {sp.generated} candidate(s) processed (new work orders created, already-open ones skipped, all logged).</span></div> : null}
      {sp.created ? <div className="card"><span className="ok-text">Schedule created.</span></div> : null}
      {sp.woedit ? <div className="card"><span className="ok-text">Card saved — the calendar below reflects the change.</span></div> : null}
      {sp.updated ? <div className="card"><span className="ok-text">Schedule updated.</span></div> : null}
      {sp.error ? <div className="card"><div className="eyebrow">NOT SAVED</div><span className="error-text">{decodeURIComponent(sp.error)}</span></div> : null}

      {/* --------------------------- interactive day view --------------------------- */}
      {selectedDay ? (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <div className="eyebrow" style={{ margin: 0 }}>{`DAY VIEW / ${selectedDay}`}</div>
            {can(ctx.roles, "wo.plan") ? (
              <Link href={`/work-orders/new?planned=${selectedDay}`} style={{ textDecoration: "none" }}>
                <button type="button" style={{ padding: "8px 14px" }}>+ ADD CARD</button>
              </Link>
            ) : null}
          </div>
          {(() => {
            const dayWos = allWos.filter((wo) => {
              const ref = wo.plannedStart ?? wo.createdAt;
              return ref >= selectedDayStart! && ref < selectedDayEnd! && wo.status !== "cancelled";
            });
            return dayWos.length === 0 ? (
              <p className="empty-state" style={{ margin: "4px 0 0" }}>
                Nothing planned on this date yet.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {dayWos.map((wo) => (
                  <div key={wo.id} className="dayrow">
                    <Link href={`/work-orders/${wo.id}`} className="dayrow-card">
                      <span className="dayrow-num">{wo.number}</span>
                      <span className="dayrow-title">{wo.title}</span>
                      {machineTag(wo.machineId) ? <span className="tag">{machineTag(wo.machineId)}</span> : null}
                      <span className={`tag st-${wo.status}`}>{wo.status.replace("_", " ")}</span>
                    </Link>
                    {["draft", "planned", "assigned", "in_progress", "on_hold"].includes(wo.status) ? (
                      <div className="dayrow-actions">
                        <Link href={`/work-orders/${wo.id}/edit`} className="row-btn">
                          EDIT
                        </Link>
                        <form action={transitionWorkOrderAction}>
                          <input type="hidden" name="workOrderId" value={wo.id} />
                          <input type="hidden" name="to" value="cancelled" />
                          <input type="hidden" name="reason" value="Removed from planning calendar" />
                          <input type="hidden" name="back" value={`/planning?month=${monthParam}&day=${selectedDay}`} />
                          <button type="submit" className="row-btn">
                            REMOVE
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      ) : null}

      {/* ------------------------------ calendar ------------------------------ */}
      <div className="card">
        <div className="eyebrow">
          {`${MONTHS[month0]?.toUpperCase()} ${year} — ${monthWos.length} SCHEDULED CARD(S)`}
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <Link href={`/planning?month=${prev.toISOString().slice(0, 7)}`} style={{ color: "var(--accent)", fontSize: 11 }}>← {MONTHS[prev.getUTCMonth()]}</Link>
          <Link href="/planning" style={{ color: "var(--dim2)", fontSize: 11 }}>TODAY</Link>
          <Link href={`/planning?month=${next.toISOString().slice(0, 7)}`} style={{ color: "var(--accent)", fontSize: 11 }}>{MONTHS[next.getUTCMonth()]} →</Link>
        </div>
        <table className="cal">
          <thead>
            <tr>
              {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((d) => (
                <th key={d}>{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi}>
                {week.map((day, di) => (
                  <td
                    key={di}
                    className={day === null ? "off" : day === selectedDayNum ? "selected" : undefined}
                  >
                    {day !== null ? (
                      <>
                        <Link
                          href={`/planning?month=${monthParam}&day=${monthParam}-${String(day).padStart(2, "0")}`}
                          className={`daynum${day === selectedDayNum ? " sel" : ""}`}
                          title="Open this day below"
                        >
                          {day}
                        </Link>
                        {(byDay.get(day) ?? []).slice(0, 3).map((wo) => (
                          <Link key={wo.id} href={`/work-orders/${wo.id}`} className={`chip${wo.status === "in_progress" ? " hot" : ""}`}>
                            {wo.number} {wo.title}
                          </Link>
                        ))}
                        <Link
                          href={`/planning?month=${monthParam}&day=${monthParam}-${String(day).padStart(2, "0")}`}
                          className="daymore"
                        >
                          {(byDay.get(day)?.length ?? 0) > 3
                            ? `+${(byDay.get(day)?.length ?? 0) - 3} more`
                            : "+ more"}
                        </Link>
                      </>
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ------------------------------- backlog ------------------------------ */}
      <div className="card">
        <div className="eyebrow">{`BACKLOG / ${backlog.length} OPEN`}</div>
        {backlog.length === 0 ? (
          <p className="empty-state" style={{ margin: 0 }}>Nothing open. Generate PM work or plan a card.</p>
        ) : (
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {backlog.map((wo) => (
              <Link key={wo.id} href={`/work-orders/${wo.id}`} style={{ textDecoration: "none", border: "1px solid var(--line)", padding: "3px 8px", fontSize: 10 }}>
                {wo.number} {wo.title.slice(0, 26)} · {wo.status}
                {machineTag(wo.machineId) ? ` · ${machineTag(wo.machineId)}` : ""}
              </Link>
            ))}
          </div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <form action={generatePmAction}>
            <input type="hidden" name="dryRun" value="1" />
            <button type="submit" className="secondary">PREVIEW DUE PMs (DRY RUN)</button>
          </form>
          {can(ctx.roles, "wo.plan") ? (
            <form action={generatePmAction}>
              <button type="submit">RUN PM GENERATION</button>
            </form>
          ) : null}
          <Link href="/work-orders/new" style={{ textDecoration: "none" }}><button type="button" className="secondary">PLAN CARD MANUALLY</button></Link>
        </div>
      </div>

      {/* ------------------------------ schedules ----------------------------- */}
      <div className="card">
        <div className="eyebrow">{`PM SCHEDULES / ${schedules.length} (${schedules.filter((s) => s.active).length} active)`}</div>
        {schedules.length === 0 ? (
          <p className="empty-state" style={{ margin: 0 }}>No schedules yet — create the first below.</p>
        ) : (
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["TITLE", "TRIGGER", "MACHINE", "TEMPLATE", "LAST RUN", "NEXT DUE", "ACTIVE", ""].map((hh) => (
                  <th key={hh} style={{ textAlign: "left", fontSize: 9, letterSpacing: 1.5, color: "var(--dim2)", borderBottom: "2px solid var(--line)", padding: "6px 8px 6px 0" }}>{hh}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0" }}>{s.title}</td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0" }}>
                    {s.kind === "calendar" ? `every ${s.intervalDays}d` : s.kind === "runtime" ? `+${s.runtimeTriggerHours}h runtime` : `${s.conditionMetric} ${s.conditionOp} ${s.conditionThreshold}`}
                  </td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0" }}>{machineTag(s.machineId) ?? "—"}</td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0" }}>{templates.find((t) => t.id === s.templateId)?.name ?? "—"}</td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0" }}>{s.lastRunAt ? formatDateTime(s.lastRunAt, ctx.timezone).slice(0, 12) : "—"}</td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0" }}>{s.nextDueAt ? formatDateTime(s.nextDueAt, ctx.timezone).slice(0, 12) : "—"}</td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0" }}>{s.active ? "active" : "off"}</td>
                  <td style={{ borderBottom: "1px dashed var(--line)", padding: "6px 8px 6px 0" }}>
                    {can(ctx.roles, "wo.plan") ? (
                      <form action={toggleScheduleAction}>
                        <input type="hidden" name="scheduleId" value={s.id} />
                        <input type="hidden" name="toggle" value={s.active ? "off" : "on"} />
                        <button type="submit" className="secondary" style={{ fontSize: 9, padding: "2px 8px" }}>{s.active ? "PAUSE" : "RESUME"}</button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {recentRuns.length > 0 ? (
        <div className="card">
          <div className="eyebrow">PM GENERATION LOG</div>
          <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
            <tbody>
              {recentRuns.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: "3px 8px 3px 0", width: 150, color: "var(--dim2)" }}>{formatDateTime(r.triggeredAt, ctx.timezone)}</td>
                  <td style={{ padding: "3px 8px 3px 0" }}>{r.triggerBasis}</td>
                  <td style={{ padding: "3px 8px 3px 0" }}>{r.status}{r.workOrderId ? ` → WO` : ""}</td>
                  <td style={{ color: r.status === "failed" ? "var(--danger)" : "var(--dim2)" }}>{r.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* --------------------------- schedule creator -------------------------- */}
      {can(ctx.roles, "wo.plan") ? (
        <form action={createScheduleAction} className="card">
          <div className="eyebrow">CREATE PM SCHEDULE</div>
          <div className="row">
            <input name="title" placeholder="Title — e.g. Pump quarterly service" required style={{ flex: 1, minWidth: 220 }} />
            <select name="machineId" defaultValue="">
              <option value="">any machine</option>
              {machineOptions.map((mm) => <option key={mm.id} value={mm.id}>{mm.tag}</option>)}
            </select>
            <select name="templateId" defaultValue="">
              <option value="">no template</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <select name="kind" defaultValue="calendar">
              <option value="calendar">calendar — every N days</option>
              <option value="runtime">runtime — every N metered hours</option>
              <option value="condition">condition — when metric crosses threshold</option>
            </select>
            <input name="intervalDays" placeholder="days (calendar)" inputMode="numeric" style={{ maxWidth: 140 }} />
            <input name="runtimeTriggerHours" placeholder="hours (runtime)" inputMode="decimal" style={{ maxWidth: 140 }} />
            <select name="conditionMetric" defaultValue="">
              <option value="">metric (condition)</option>
              <option value="vibration_mm_s">vibration mm/s</option>
              <option value="temperature_c">temperature °C</option>
            </select>
            <select name="conditionOp" defaultValue=">">
              <option value=">">over</option>
              <option value="<">under</option>
            </select>
            <input name="conditionThreshold" placeholder="threshold" inputMode="decimal" style={{ maxWidth: 110 }} />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label style={{ fontSize: 11 }}>first due<input name="firstDueAt" type="datetime-local" /></label>
            <input name="notes" placeholder="notes (copied into the generated card)" style={{ flex: 1, minWidth: 180 }} />
            <button type="submit">CREATE SCHEDULE</button>
          </div>
        </form>
      ) : null}
    </>
  );
}
