export const metadata = { title: "About" };

export default function AboutPage() {
  return (
    <>
      <h1>About Custos</h1>
      <p className="lead">CUSTOS — the WhatsApp task guardian of the Cogitex suite.</p>
      <div className="card">
        <div className="eyebrow">THE PRODUCT</div>
        <p style={{ fontSize: 12, lineHeight: 1.7, color: "var(--dim)", margin: 0 }}>
          Custos (Latin: the guardian) watches the follow-through loop the
          Planner cannot automate: the owner sets tasks; staff receive them in
          ordinary WhatsApp — no app, no login; proof (ticks, numbers, photos)
          flows back to the dashboard; silence escalates to supervisor, then
          owner. One messaging adapter, two faces: a built-in simulator that
          always works, and Meta&apos;s Cloud API for the real test number.
        </p>
      </div>
    </>
  );
}
