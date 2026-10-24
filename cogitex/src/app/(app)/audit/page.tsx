import Link from "next/link";
import { formatDateTime } from "@/lib/time";
import { can } from "@/server/policies";
import { getCtx } from "@/server/ctx";
import { auditService, type AuditEntry } from "@/server/services/audit";

export const metadata = { title: "Audit trail" };
export const dynamic = "force-dynamic";

/** Human labels for the entity types the suite writes into the audit log. */
const TYPE_LABELS: Record<string, string> = {
  machine: "MACHINE",
  work_order: "WORK ORDER",
  fault_event: "FAULT",
  document: "DOCUMENT",
  inventory_item: "INVENTORY",
  purchase: "PURCHASE",
  repair_request: "REPAIR",
  report: "REPORT",
  user: "USER",
  organization: "ORG",
  import_staging: "IMPORT",
  agent_tool_log: "AGENT",
};

/** Deep links back into the app where a dossier/breadcrumb already exists. */
function entityLink(type: string, id: string): string | null {
  switch (type) {
    case "machine":
      return `/machines/${id}`;
    case "work_order":
      return `/work-orders/${id}`;
    case "inventory_item":
      return `/inventory/${id}`;
    case "purchase":
      return `/purchase/${id}`;
    case "repair_request":
      return `/repairs/${id}`;
    case "report":
      return `/reports/${id}`;
    default:
      return null;
  }
}

function actorCell(e: AuditEntry): string {
  if (e.actorName) return e.actorName;
  if (e.actorKind === "system") return "SYSTEM";
  if (e.actorKind === "webhook") return "VIDE WEBHOOK";
  if (e.actorKind === "agent") return "ORGO AGENT";
  return "—";
}

function detailText(diff: unknown): string {
  if (diff === null || diff === undefined) return "";
  try {
    const s = JSON.stringify(diff);
    return s.length > 140 ? `${s.slice(0, 140)}…` : s;
  } catch {
    return "";
  }
}

/**
 * Audit trail — governance view over the append-only log every write service
 * already produces. Filter chips are plain links (GET params), so the page
 * works with JS disabled entirely.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null; // shell layout already redirected the unauthenticated

  const allowed = can(ctx.roles, "audit.view");
  const params = (await searchParams) ?? {};
  const filterType = allowed && params.type && params.type !== "all" ? params.type : undefined;

  const [events, counts, total] = allowed
    ? await Promise.all([
        auditService.list(ctx, { entityType: filterType, limit: 200 }),
        auditService.countsByType(ctx),
        auditService.total(ctx),
      ])
    : [[], [] as { type: string; n: number }[], 0];

  return (
    <>
      <h1>Audit trail</h1>
      <p className="lead">
        Append-only record of every meaningful change in this workspace — who,
        what, when. Written by the services themselves; this page can never alter it.
      </p>

      {!allowed ? (
        <div className="card">
          <div className="eyebrow">RESTRICTED</div>
          <p style={{ fontSize: 12, color: "var(--dim)", margin: "8px 0 0" }}>
            The audit trail is visible to the account owner, admins and the
            maintenance manager. Ask them if you need a specific event reviewed.
          </p>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="row" style={{ flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span className="eyebrow" style={{ marginRight: 4 }}>FILTER</span>
              <Link
                href="/audit"
                className="secondary"
                style={{
                  fontSize: 10,
                  padding: "4px 10px",
                  textDecoration: "none",
                  fontWeight: !filterType ? 700 : 400,
                }}
              >
                ALL · {total}
              </Link>
              {counts.map((c) => (
                <Link
                  key={c.type}
                  href={`/audit?type=${c.type}`}
                  className="secondary"
                  style={{
                    fontSize: 10,
                    padding: "4px 10px",
                    textDecoration: "none",
                    fontWeight: filterType === c.type ? 700 : 400,
                  }}
                >
                  {TYPE_LABELS[c.type] ?? c.type.toUpperCase()} · {c.n}
                </Link>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              {filterType ? `EVENTS · ${(TYPE_LABELS[filterType] ?? filterType).toUpperCase()}` : "RECENT EVENTS"}
            </div>
            {events.length === 0 ? (
              <p className="empty-state" style={{ margin: 0 }}>No events on record{filterType ? " for this filter" : ""} yet.</p>
            ) : (
              <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["WHEN", "WHO", "ACTION", "ENTITY", "DETAIL"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "6px 8px 6px 0", borderBottom: "1px solid var(--line)", fontSize: 9, letterSpacing: 1.5, color: "var(--dim2)" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => {
                    const href = entityLink(e.entityType, e.entityId);
                    return (
                      <tr key={e.id}>
                        <td style={{ padding: "7px 8px 7px 0", whiteSpace: "nowrap", borderBottom: "1px solid var(--line)", color: "var(--dim)" }}>
                          {formatDateTime(e.occurredAt)}
                        </td>
                        <td style={{ padding: "7px 8px 7px 0", whiteSpace: "nowrap", borderBottom: "1px solid var(--line)" }}>
                          {actorCell(e)}
                          {e.actorEmail ? <span style={{ color: "var(--dim2)" }}> · {e.actorEmail}</span> : null}
                        </td>
                        <td style={{ padding: "7px 8px 7px 0", fontFamily: "var(--font-mono)", fontSize: 10, whiteSpace: "nowrap", borderBottom: "1px solid var(--line)" }}>
                          {e.action}
                        </td>
                        <td style={{ padding: "7px 8px 7px 0", whiteSpace: "nowrap", borderBottom: "1px solid var(--line)", color: "var(--dim)" }}>
                          {href ? (
                            <Link href={href} style={{ textDecoration: "none", color: "var(--accent)" }}>
                              {(TYPE_LABELS[e.entityType] ?? e.entityType).toUpperCase()} →
                            </Link>
                          ) : (
                            (TYPE_LABELS[e.entityType] ?? e.entityType).toUpperCase()
                          )}
                        </td>
                        <td style={{ padding: "7px 8px 7px 0", borderBottom: "1px solid var(--line)", color: "var(--dim2)", fontFamily: "var(--font-mono)", fontSize: 9.5 }}>
                          {detailText(e.diff)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
