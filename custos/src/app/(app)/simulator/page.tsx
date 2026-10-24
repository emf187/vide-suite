import Link from "next/link";
import { getCtx } from "@/server/ctx";
import { normalizePhone } from "@/server/services/persons";
import { peopleForPicker, transcriptFor } from "@/server/services/simulator";
import { sendAsAction } from "./actions";
import type { MessageRow, Person } from "@/server/db/schema";

export const metadata = { title: "WhatsApp Simulator" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  target: "Pick a person or enter a number first.",
  too_large: "That photo is larger than 10 MB — send a smaller one.",
  empty: "Type a message or attach a photo, then send.",
};

type ButtonsPayload = {
  buttons?: { id: string; label: string }[];
  sections?: { title: string; rows: { id: string; title: string }[] }[];
};

/** Africa/Lagos = UTC+1, no daylight saving (brief §7). */
function lagosTime(d: Date): string {
  const t = new Date(d.getTime() + 60 * 60 * 1000);
  return `${t.toISOString().slice(11, 16)} LAGOS`;
}

function OutboundBits({ row }: { row: MessageRow }) {
  const payload = row.buttonsPayload as ButtonsPayload | null;
  if (payload?.buttons?.length) {
    return (
      <span className="sim-chips">
        {payload.buttons.map((b) => (
          <span key={b.id} className="sim-chip">{b.label}</span>
        ))}
      </span>
    );
  }
  if (payload?.sections?.length) {
    return (
      <span style={{ display: "block", marginTop: 6 }}>
        {payload.sections.map((s) => (
          <span key={s.title} style={{ display: "block", fontSize: 10.5, color: "var(--dim)", marginTop: 5 }}>
            {s.title}: {s.rows.map((r) => r.title).join(" · ")}
          </span>
        ))}
      </span>
    );
  }
  return null;
}

function Bubble({ row, personName }: { row: MessageRow; personName: string }) {
  const inbound = row.direction === "in";
  const tags = [
    row.type === "template" ? `TEMPLATE ${row.templateName ?? ""}` : row.type === "interactive" ? "BUTTONS" : row.type === "photo" ? "PHOTO" : null,
    row.type === "photo" && row.mediaId ? `MEDIA ${row.mediaId.slice(0, 8)}` : null,
    row.status === "failed" ? `FAILED ${row.failureReason ?? ""}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className={`sim-row${inbound ? " in" : ""}`}>
      <div className="sim-bubble">
        {inbound ? (
          <span style={{ display: "block", fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: "var(--accent-deep)", marginBottom: 3 }}>
            {personName}
          </span>
        ) : null}
        {row.body}
        <OutboundBits row={row} />
        {tags.length ? <span className="sim-meta">{tags.join(" · ")} · {lagosTime(row.createdAt)}</span> : <span className="sim-meta">{lagosTime(row.createdAt)}</span>}
      </div>
    </div>
  );
}

export default async function SimulatorPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; phone?: string; error?: string }>;
}) {
  const ctx = await getCtx();
  if (!ctx) return null;
  const sp = await searchParams;

  const people = await peopleForPicker(ctx);
  const person: Person | null = sp.p ? (people.find((x) => x.id === sp.p) ?? null) : null;
  const phone = person ? person.phoneE164 : sp.phone ? normalizePhone(sp.phone) : null;
  const rows = person || phone ? await transcriptFor(person, phone!) : [];
  const error = sp.error ? (ERRORS[sp.error] ?? null) : null;
  const backTo = person ? `p=${encodeURIComponent(person.id)}` : phone ? `phone=${encodeURIComponent(phone)}` : "";

  return (
    <>
      <h1>WhatsApp simulator</h1>
      <p className="lead">
        The phone-style chat that plays WhatsApp in demo mode. Pick a registered
        person to speak AS them, or open a bare number to see the bot&apos;s
        unregistered-number behavior. Every line here is a real message_log row;
        every reply comes from the same inbound pipeline the M7 webhook will use.
      </p>

      {error ? (
        <div className="card" style={{ borderLeft: "3px solid var(--crit)" }}>
          <p style={{ fontSize: 12, margin: 0 }} role="alert">{error}</p>
        </div>
      ) : null}

      <div className="card">
        <div className="eyebrow">SPEAK AS</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0" }}>
          {people.map((p) => (
            <Link
              key={p.id}
              href={`/simulator?p=${p.id}`}
              className={`sim-chip${p.id === person?.id ? " active" : ""}`}
            >
              {p.name} · {p.role}
            </Link>
          ))}
          {people.length === 0 ? (
            <span style={{ fontSize: 11, color: "var(--dim)" }}>
              No people registered yet — add them under People (M2), or tap a bare number below to see the unregistered path.
            </span>
          ) : null}
        </div>
        <form method="get" action="/simulator" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            name="phone"
            placeholder="Bare number, e.g. +234803…"
            style={{ maxWidth: 240 }}
          />
          <button type="submit" className="secondary">OPEN CHAT</button>
        </form>
      </div>

      {person || phone ? (
        <>
          <div className="sim-frame" aria-live="polite">
            {rows.length === 0 ? (
              <span className="sim-note">No messages yet — send the first one below.</span>
            ) : (
              rows.map((row) => <Bubble key={row.id} row={row} personName={person?.name ?? phone ?? "?"} />)
            )}
          </div>

          <div className="card">
            <form action={sendAsAction} encType="multipart/form-data" className="sim-composer">
              {person ? <input type="hidden" name="personId" value={person.id} /> : null}
              {!person && phone ? <input type="hidden" name="phone" value={phone} /> : null}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  name="body"
                  placeholder={person ? `Type as ${person.name}…` : `Type as ${phone}…`}
                  style={{ flex: 1 }}
                />
                <button type="submit" className="auth-btn-primary">SEND</button>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span className="sim-note">QUICK:</span>
                {[
                  ["menu", "MENU"],
                  ["help", "HELP"],
                  ["tasks", "TASKS"],
                  ["start", "START"],
                  ["wahala", "WAHALA"],
                ].map(([value, label]) => (
                  <button key={value} type="submit" name="quick" value={value} className="sim-chip">
                    {label}
                  </button>
                ))}
                <input type="file" name="photo" accept="image/*" style={{ fontSize: 10, maxWidth: 220 }} />
              </div>
            </form>
          </div>
        </>
      ) : (
        <div className="card">
          <div className="eyebrow">NO CHAT OPEN</div>
          <p style={{ fontSize: 12, color: "var(--dim)", margin: "6px 0 0" }}>
            Pick a person above or open a bare number to start a conversation.
          </p>
        </div>
      )}

      <div className="card">
        <div className="eyebrow">HOW THIS MODE WORKS</div>
        <p style={{ fontSize: 12, lineHeight: 1.7, color: "var(--dim)", margin: 0 }}>
          The bot logic never knows which messenger it is talking to. Today the
          provider is the simulator (writes straight to message_log); on M7 the
          same pipeline is fed by Meta&apos;s signed webhook. Unregistered
          numbers get one polite reply, STOPped numbers get silence, and every
          state transition lands in the audit trail.
        </p>
      </div>
    </>
  );
}
