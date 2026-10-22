import { notFound } from "next/navigation";
import { flattenNav } from "@/components/layout/nav";

const MILESTONE_NOTES: Record<string, string> = {
  planning: "Calendar + Kanban views, preventive schedules that auto-generate work orders.",
  "work-orders": "Full work order lifecycle with checklists, parts, labor and cost roll-up.",
  inventory: "Items, suppliers, the append-only stock ledger and reservations.",
  repairs: "Verified Technician requests with the confirm-before-send flow.",
  reports: "Scheduled machine and plant reports with computed metrics and PDF/CSV export.",
  agent: "The maintenance agent — read-only records tools, write tools behind confirmation.",
};

/** Placeholder pages for milestones not built yet (gated nav keeps demo coherent). */
export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const nav = flattenNav().find((item) => item.href === `/${section}`);
  if (!nav) notFound();

  return (
    <>
      <h1>{nav.label}</h1>
      <p className="lead">Planned feature — scheduled for milestone {nav.milestone}.</p>
      <div className="card">
        <div className="eyebrow">WHAT LANDS HERE</div>
        <div style={{ color: "var(--dim)", fontSize: 12, lineHeight: 1.8 }}>
          {MILESTONE_NOTES[section] ?? "Per the build plan: see docs/ARCHITECTURE.md §12."}
        </div>
        <div className="empty-state" style={{ marginTop: 14 }}>
          NOT BUILT YET · MILESTONE {nav.milestone}
        </div>
      </div>
    </>
  );
}
