export type Role =
  | "owner"
  | "admin"
  | "maintenance_manager"
  | "technician"
  | "viewer"
  | "external_technician";

export type Urgency = "low" | "medium" | "high" | "critical";

export const ALL_ROLES: Role[] = [
  "owner",
  "admin",
  "maintenance_manager",
  "technician",
  "viewer",
  "external_technician",
];

export const ADMIN_ROLES: Role[] = ["owner", "admin"];
