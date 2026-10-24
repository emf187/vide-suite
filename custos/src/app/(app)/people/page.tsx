import { getCtx } from "@/server/ctx";
import { getDb, type AppDb } from "@/server/db/client";
import { orgsRepo } from "@/server/repos/base";
import { INDUSTRIES } from "@/lib/industries";
import { personsService } from "@/server/services/persons";
import { registerPersonAction, reactivateAction } from "./actions";

export const metadata = { title: "People & consent" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  fields: "Check the fields — a name (2+ letters), a role, and a phone number like +23480….",
  phone_conflict: "That number is already registered in this workspace — one workspace knows each number once.",
};

const CONSENT_LABEL: Record<string, { text: string; tone: string }> = {
  opted_in: { text: "OPTED IN", tone: "var(--ok)" },
  pending: { text: "PENDING — WAITS FOR START", tone: "var(--warn)" },
  stopped: { text: "STOPPED — SILENCED", tone: "var(--crit)" },
};

const ROLES = ["supervisor", "staff", "technician"] as const;

/** People & consent (M2): the heads add people; THE PERSON always owns the START. */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const sp = await searchParams;
  const people = await personsService.list(ctx);
  const org = await orgsRepo.byId((await getDb()) as AppDb, ctx.orgId);
  const industry = org ? INDUSTRIES.find((i) => i.id === org.industry) : null;
  const error = sp.error ? (ERRORS[sp.error] ?? "Something didn't save — check the fields.") : null;

  return (
    <>
      <h1>People &amp; consent</h1>
      <p className="lead">
        {ctx.orgName}
        {industry ? ` · ${industry.label}` : ""} · add the people who will answer; the moment they message{" "}
        <strong>START</strong> from their own number, they own the consent.
      </p>

      {sp.ok ? (
        <div className="card" style={{ borderLeft: "3px solid var(--ok)" }}>
          <p style={{ fontSize: 12, margin: 0, color: "var(--ok)" }}>
            {sp.ok === "reopened" ? "Consent reopened — they message START to rejoin." : "Person added — the ball is in their court."}
          </p>
        </div>
      ) : null}
      {error ? (
        <div className="card" style={{ borderLeft: "3px solid var(--crit)" }}>
          <p style={{ fontSize: 12, margin: 0 }} role="alert">{error}</p>
        </div>
      ) : null}

      <div className="card">
        <div className="eyebrow">ADD A PERSON</div>
        <form action={registerPersonAction} style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 9rem 12rem auto", margin: "10px 0" }}>
          <div>
            <label className="field-label" htmlFor="p-name">NAME</label>
            <input id="p-name" name="name" required minLength={2} maxLength={80} />
          </div>
          <div>
            <label className="field-label" htmlFor="p-role">ROLE</label>
            <select id="p-role" name="role" defaultValue="staff">
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="p-phone">WHATSAPP NUMBER</label>
            <input id="p-phone" name="phone" placeholder="+23480…" required />
          </div>
          <div style={{ alignSelf: "end" }}>
            <button type="submit" className="auth-btn-primary">ADD</button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="eyebrow">ROSTER · {people.length}</div>
        {people.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--dim)", margin: "8px 0 0" }}>
            Nobody yet — add your first person above.
          </p>
        ) : (
          <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", marginTop: 8 }}>
            <tbody>
              {people.map((p) => {
                const badge = CONSENT_LABEL[p.consentStatus] ?? { text: "UNKNOWN", tone: "var(--dim)" };
                return (
                  <tr key={p.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "8px 10px 8px 0", fontWeight: 700 }}>{p.name}{p.deactivatedAt ? " ⛔" : ""}</td>
                    <td style={{ padding: "8px 10px 8px 0" }}>{p.role}</td>
                    <td style={{ padding: "8px 10px 8px 0", color: "var(--dim)" }}>{p.phoneE164}</td>
                    <td style={{ padding: "8px 10px 8px 0", color: badge.tone, fontWeight: 700, whiteSpace: "nowrap" }}>{badge.text}</td>
                    <td style={{ padding: "8px 0 8px 10px", textAlign: "right" }}>
                      {p.consentStatus === "stopped" ? (
                        <form action={reactivateAction}>
                          <input type="hidden" name="personId" value={p.id} />
                          <button type="submit" className="secondary" style={{ padding: "6px 10px", borderRadius: 8, fontSize: 10 }}>
                            REOPEN CONSENT
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="eyebrow">HOW CONSENT WORKS</div>
        <p style={{ fontSize: 12, lineHeight: 1.7, color: "var(--dim)", margin: 0 }}>
          1. You add a person here — they stay <strong>pending</strong>. 2. The person messages{" "}
          <strong>START</strong> from their own number — Custos records their opt-in, audit-logged, and opens their
          menu. 3. A person who sends <strong>STOP</strong> gets exactly one confirmation and then true silence —
          nothing further is ever sent; you can only reopen consent from this page. In simulator mode the
          conversation happens in the WhatsApp Simulator; on real WhatsApp (M7) it happens on your business number.
        </p>
      </div>
    </>
  );
}
