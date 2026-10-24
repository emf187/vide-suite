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
  too_large: "That file is larger than 16 MB — WhatsApp caps media there; send something smaller.",
  empty: "Type a message, tap a quick word, or attach a file — then send.",
};

type ButtonsPayload = {
  buttons?: { id: string; label: string }[];
  sections?: { title: string; rows: { id: string; title: string; description?: string }[] }[];
};

type TargetIdent = { personId?: string; phone?: string };

/** Africa/Lagos = UTC+1, no daylight saving (brief §7). */
function lagosTime(d: Date): string {
  const t = new Date(d.getTime() + 60 * 60 * 1000);
  return `${t.toISOString().slice(11, 16)} LAGOS`;
}

/** Bot-interactive rows become TAPPABLE: every chip is a form submit — zero JS. */
function OutboundBits({ row, target }: { row: MessageRow; target: TargetIdent }) {
  const payload = row.buttonsPayload as ButtonsPayload | null;
  if (!payload) return null;
  if (payload.buttons?.length) {
    return (
      <span className="sim-chips">
        {payload.buttons.map((b) => (
          <form key={b.id} action={sendAsAction}>
            <input type="hidden" name="personId" value={target.personId ?? ""} />
            <input type="hidden" name="phone" value={target.phone ?? ""} />
            <button type="submit" name="tap" value={b.id} className="sim-chip">
              {b.label}
            </button>
          </form>
        ))}
      </span>
    );
  }
  if (payload.sections?.length) {
    return (
      <span className="sim-chips">
        {payload.sections.map((s) => (
          <span key={s.title} style={{ display: "block" }}>
            <span className="sim-meta">{s.title}</span>
            {s.rows.map((r) => (
              <form key={r.id} action={sendAsAction}>
                <input type="hidden" name="personId" value={target.personId ?? ""} />
                <input type="hidden" name="phone" value={target.phone ?? ""} />
                <button type="submit" name="tap" value={r.id} className="sim-chip" title={r.description ?? undefined}>
                  {r.title}
                </button>
              </form>
            ))}
          </span>
        ))}
      </span>
    );
  }
  return null;
}

function Bubble({ row, personName, target }: { row: MessageRow; personName: string; target: TargetIdent }) {
  const inbound = row.direction === "in";
  const tags = [
    row.type === "template" ? `TEMPLATE ${row.templateName ?? ""}` : row.type === "interactive" ? "TAP →" : row.type === "media" ? `MEDIA ${row.mediaId?.slice(0, 8) ?? ""}` : null,
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
        <OutboundBits row={row} target={target} />
        {tags.length ? (
          <span className="sim-meta">{tags.join(" · ")} · {lagosTime(row.createdAt)}</span>
        ) : (
          <span className="sim-meta">{lagosTime(row.createdAt)}</span>
        )}
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
  const target: TargetIdent = person ? { personId: person.id } : { phone: phone ?? "" };
  const consentNote =
    person?.consentStatus === "pending" ? " · PENDING — send START" : person?.consentStatus === "stopped" ? " · STOPPED (silent — reopen from People)" : "";

  return (
    <>
      <h1>WhatsApp simulator</h1>
      <p className="lead">
        The phone-style chat that plays WhatsApp in demo mode. Pick a registered person to speak AS them, or open a
        bare number to see the unregistered-number behavior. Tappable chips are real choices — the bot receives them
        as button taps. Every line is a message_log row through the same pipeline the M7 webhook feeds.
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
              {p.consentStatus === "pending" ? " ·⏳" : ""}
            </Link>
          ))}
          {people.length === 0 ? (
            <span style={{ fontSize: 11, color: "var(--dim)" }}>
              No people yet — add them under People, or tap a bare number below to see the unregistered path.
            </span>
          ) : null}
        </div>
        <form method="get" action="/simulator" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input name="phone" placeholder="Bare number, e.g. +234803…" style={{ maxWidth: 240 }} />
          <button type="submit" className="secondary">OPEN CHAT</button>
        </form>
      </div>

      {person || phone ? (
        <>
          <div className="sim-frame" aria-live="polite">
            {rows.length === 0 ? (
              <span className="sim-note">No messages yet — send the first one below.</span>
            ) : (
              rows.map((row) => <Bubble key={row.id} row={row} personName={person?.name ?? phone ?? "?"} target={target} />)
            )}
          </div>

          <div className="card">
            <form action={sendAsAction} encType="multipart/form-data" className="sim-composer">
              {person ? <input type="hidden" name="personId" value={person.id} /> : null}
              {!person && phone ? <input type="hidden" name="phone" value={phone} /> : null}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  name="body"
                  placeholder={person ? `Type as ${person.name}${consentNote}…` : `Type as ${phone}…`}
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
                  ["stop", "STOP"],
                  ["wahala", "WAHALA"],
                ].map(([value, label]) => (
                  <button key={value} type="submit" name="quick" value={value} className="sim-chip">
                    {label}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="file"
                  name="photo"
                  accept="image/*,video/*,audio/*,.pdf"
                  style={{ fontSize: 10 }}
                />
                <span className="sim-note">PHOTO · VIDEO · VOICE · PDF · ≤ 16 MB</span>
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
          The bot logic never knows which messenger it is talking to. Today the provider is the simulator (writes
          straight to message_log); on M7 the same pipeline is fed by Meta&apos;s signed webhook. Unregistered numbers
          get one polite reply, pending numbers wait for START, STOP gets one confirmation and then true silence, and
          every state transition lands in the audit trail. Media bytes are stored outside the web root and survive
          restarts in this mode.
        </p>
      </div>
    </>
  );
}
