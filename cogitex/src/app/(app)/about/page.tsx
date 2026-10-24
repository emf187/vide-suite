import { getCtx } from "@/server/ctx";
import { getIntegrations } from "@/lib/integrations/factory";
import { CALC_VERSION } from "@/server/metrics/reports";
import { FullLogo } from "@/components/layout/Logo";

export const metadata = { title: "About" };

const MILESTONES: { id: string; title: string; note: string }[] = [
  { id: "M0–M3", title: "Foundation", note: "Auth, tenancy, orgs with audit trail, machine registry with VIDE device links, planning templates/schedules, work orders with checklists, documents, inventory with append-only stock ledger + reservations." },
  { id: "M4", title: "VIDE connect", note: "Secret-verified fault webhook; machines resolved strictly by their linked VIDE device name; health/energy cache-through with TTL; triage with ack/dismiss/convert." },
  { id: "M5", title: "Repair marketplace", note: "Deterministic compile of a repair brief, explicit human confirm before send, status lifecycle reconciled by webhook, withdraw-before-acceptance, confirm + rate on completion." },
  { id: "M6", title: "Reports", note: "Deterministic versioned calc bundles (MTTR/MTBF/uptime/planned-ratio, cost rollups) — numbers come from code, never a model; server-side CSV and PDF exports." },
  { id: "M7", title: "Agent", note: "Org-scoped read tools with citations; write actions proposed in chat and executed only after explicit CONFIRM; every tool call logged. Intent matching is deterministic unless a model key is configured — and a model only ever maps text to a tool." },
  { id: "M8", title: "Progressive web app", note: "Installable manifest with the mark logo, static-only service worker (pages stay network-only so sessions are never cached), security headers, and the enriched demo data set." },
  { id: "M9", title: "Docs, audit + dossiers", note: "Work-order comment threads with provenance rails, multimedia file library, a full-page note editor with a word-processor toolbar; the org-wide audit trail viewer and the printable machine dossier." },
];

/** M8 app-info page — the ONE context where the with-name lockup is used. */
export default async function AboutPage() {
  const ctx = await getCtx();
  if (!ctx) return null;
  const integrations = getIntegrations();

  return (
    <>
      <h1>About the app</h1>
      <p className="lead">
        ORGO — the maintenance manager — everything about a machine, its repairs,
        parts and next job in one place.
      </p>

      <div className="card" style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <FullLogo width={200} />
        <div style={{ fontSize: 11, lineHeight: 1.7, color: "var(--dim)" }}>
          <div style={{ letterSpacing: 2, color: "var(--accent)", fontSize: 10 }}>THE PRODUCT</div>
          A single-tenant-per-workspace maintenance console for factory teams. Your data stays in
          your workspace; external VIDE services are reached only through adapters, and every
          number on these pages is computed in code and shows its calc version
          ({`v${CALC_VERSION}`} at present).
        </div>
      </div>

      <div className="card">
        <div className="eyebrow">WHAT SHIPPED</div>
        <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
          <tbody>
            {MILESTONES.map((m) => (
              <tr key={m.id}>
                <td style={{ padding: "7px 10px 7px 0", whiteSpace: "nowrap", color: "var(--accent)", fontWeight: 700, width: 58 }}>{m.id}</td>
                <td style={{ padding: "7px 10px 7px 0", minWidth: 110 }}>{m.title}</td>
                <td style={{ padding: "7px 0", color: "var(--dim)" }}>{m.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="eyebrow">HOW DATA FLOWS</div>
        <p className="kv"><span className="k">This app owns</span><span className="v">Machines · plans · work orders · documents · inventory & stock history · fault events intake · repair requests · reports · agent</span></p>
        <p className="kv"><span className="k">VIDE owns</span><span className="v">Telemetry · health · energy · marketplace delivery · identity providers (integration adapters only — no VIDE URLs or keys live in this codebase)</span></p>
        <p className="kv"><span className="k">Integration profile</span><span className="v">{integrations.profile === "real" ? "REAL — verified VIDE endpoints" : "MOCK — local fixture adapters (safe to click everything)"}</span></p>
        <p className="kv"><span className="k">Money</span><span className="v">Integer kobo with currency column; timestamps UTC, displayed in {ctx.timezone}</span></p>
        <p className="kv"><span className="k">Roles & audit</span><span className="v">Always derived from the verified session — never from the browser or a model — and every write lands in an append-only audit trail</span></p>
      </div>

      <div className="card">
        <div className="eyebrow">CONTACT</div>
        <p className="kv"><span className="k">Questions</span><span className="v">Ask the maintenance agent on this console — it reads your workspace before answering</span></p>
        <p className="kv"><span className="k">Escalation</span><span className="v">Through the support channel your organization was onboarded with</span></p>
        <p className="kv" style={{ borderBottom: "none" }}><span className="k">Version</span><span className="v">M8 · calc v{CALC_VERSION}</span></p>
      </div>
    </>
  );
}
