import { randomUUID } from "node:crypto";

/** Dashboard roles + WhatsApp-side roles share one vocabulary (§2). */
export type Role = "owner" | "supervisor" | "staff" | "technician";

export const ALL_ROLES: Role[] = ["owner", "supervisor", "staff", "technician"];

/** WhatsApp conversation states (§5) — data lives in conversation_states.context. */
export type ConversationStateName =
  | "idle"
  | "awaiting_task_choice"
  | "awaiting_reading"
  | "awaiting_photo"
  | "awaiting_checklist_step"
  | "awaiting_problem_text"
  | "awaiting_problem_asset"
  | "awaiting_refill_confirm";

export function newOrgSlug(): string {
  return `org-${randomUUID().slice(0, 6)}`;
}
