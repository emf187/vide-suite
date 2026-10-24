export const metadata = { title: "People" };

/** M2: owner adds people (name, role, phone), consent instructions appear here. */
export default function PeoplePage() {
  return (
    <>
      <h1>People</h1>
      <p className="lead">M2 milestone — register staff, capture START opt-ins, show who is reachable.</p>
      <div className="card">
        <div className="eyebrow">MILESTONE M2 · NOT BUILT YET</div>
        <p style={{ fontSize: 12, color: "var(--dim)", margin: "8px 0 0" }}>
          Plan: add a person (name, role, phone), then the bot greets them on
          START with their name and role. STOP removes consent immediately.
        </p>
      </div>
    </>
  );
}
