export const metadata = { title: "WhatsApp Simulator" };

/** M1: the phone-style chat screen (send text/taps/lists + photo upload as any person). */
export default function SimulatorPage() {
  return (
    <>
      <h1>WhatsApp simulator</h1>
      <p className="lead">M1 milestone — the phone-style chat screen arrives with the messaging adapter.</p>
      <div className="card">
        <div className="eyebrow">MILESTONE M1 · NOT BUILT YET</div>
        <p style={{ fontSize: 12, color: "var(--dim)", margin: "8px 0 0" }}>
          Plan: pick a registered person, chat as them exactly like WhatsApp
          (text, button taps, list choices, photo upload), every message round
          goes through the same inbound pipeline as real WhatsApp mode will.
        </p>
      </div>
    </>
  );
}
