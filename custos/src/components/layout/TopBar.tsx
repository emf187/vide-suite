/** Top bar — org name + placeholder message-mode chip (goes live in M1). */
export function TopBar({ orgName }: { orgName: string }) {
  return (
    <div className="topbar">
      <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.5 }}>{orgName}</span>
      <span className="tag" style={{ fontSize: 9, letterSpacing: 1 }}>MODE · SIMULATOR</span>
    </div>
  );
}
