import { ADMIN_ROLES, type Role } from "@/lib/shared/types";

/**
 * Server-side ability matrix (docs/ARCHITECTURE.md §4). UI affordances mirror this,
 * but enforcement here is authoritative.
 */
export type Ability =
  | "plan.manage" // create/edit machines, schedules, lifecycle proposals
  | "wo.plan" // draft/plan/assign/verify/close work orders
  | "wo.execute" // start/complete/checklist/labor/photos/notes
  | "wo.issueToOwnWo" // issue inventory parts against own WO
  | "wo.runExternalJobs" // external technician executes assigned jobs
  | "inventory.manage" // items, ledger ops, suppliers
  | "repairRequests.send" // reply-only compile/confirm/rate
  | "repairRequests.viewOwn"
  | "report.view" // view + generate deterministic reports
  | "audit.view" // org-wide audit trail (governance)
  | "decommission.execute"
  | "hardDelete"
  | "settings.manage";

const MATRIX: Record<Ability, Set<Role>> = {
  "plan.manage": new Set<Role>(["owner", "admin", "maintenance_manager"]),
  "wo.plan": new Set<Role>(["owner", "admin", "maintenance_manager"]),
  "wo.execute": new Set<Role>(["owner", "admin", "maintenance_manager", "technician"]),
  "wo.issueToOwnWo": new Set<Role>(["owner", "admin", "maintenance_manager", "technician"]),
  "wo.runExternalJobs": new Set<Role>(["external_technician"]),
  "inventory.manage": new Set<Role>(["owner", "admin", "maintenance_manager"]),
  "repairRequests.send": new Set<Role>(["owner", "admin", "maintenance_manager"]),
  "repairRequests.viewOwn": new Set<Role>(["owner", "admin", "maintenance_manager", "external_technician"]),
  "report.view": new Set<Role>(["owner", "admin", "maintenance_manager", "technician", "viewer"]),
  "audit.view": new Set<Role>(["owner", "admin", "maintenance_manager"]),
  "decommission.execute": new Set<Role>(["owner", "admin"]),
  "hardDelete": new Set<Role>(["owner", "admin"]),
  "settings.manage": new Set<Role>(["owner", "admin"]),
};

export function can(roles: Role[], ability: Ability): boolean {
  return roles.some((role) => MATRIX[ability]?.has(role) ?? false);
}

export function isAdmin(roles: Role[]): boolean {
  return roles.some((role) => ADMIN_ROLES.includes(role));
}

export function describeAbility(ability: Ability): string {
  return ability;
}
