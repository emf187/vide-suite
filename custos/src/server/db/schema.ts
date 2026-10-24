/**
 * CUSTOS data model — the WhatsApp task guardian (docs/README.md build order).
 * Same conventions as the sibling Planner: money = integer kobo, timestamps
 * UTC timestamptz, every business table carries organization_id (tenant wall).
 * The conversation/bot tables are append-heavy and read hot; indexes follow
 * the read paths (inbound pipeline: wa_message_id dedupe; scheduler: tasks
 * by due_at).
 */
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  date,
  numeric,
  uniqueIndex,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";
import { organizations, users } from "./base";

/* ------------------------------ enums --------------------------------- */

export const custosRoleEnum = pgEnum("custos_role", ["owner", "supervisor", "staff", "technician"]);
export const consentStatusEnum = pgEnum("custos_consent_status", ["pending", "opted_in", "stopped"]);
export const taskTypeEnum = pgEnum("custos_task_type", ["simple_done", "reading", "photo_proof", "checklist", "count"]);
export const taskStatusEnum = pgEnum("custos_task_status", ["pending", "done", "cant_do", "overdue"]);
export const evidenceKindEnum = pgEnum("custos_evidence_kind", ["photo", "number", "text"]);
export const problemPriorityEnum = pgEnum("custos_problem_priority", ["low", "normal", "urgent"]);
export const readingKindEnum = pgEnum("custos_reading_kind", ["temperature", "gas_kg", "run_hours"]);

/* ------------------------------ bots' people --------------------------- */

/**
 * A person the WhatsApp bot knows. Registered by the owner (dashboard), then
 * opt-in happens when the PERSON messages START (consent lives with them, §4.1).
 * phone_e164 is unique per org — one workspace knows each number once.
 */
export const persons = pgTable("persons", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  role: custosRoleEnum("role").notNull().default("staff"),
  phoneE164: text("phone_e164").notNull(),
  consentStatus: consentStatusEnum("consent_status").notNull().default("pending"), // START flips to opted_in; STOP to stopped
  consentAt: timestamp("consent_at", { withTimezone: true }),
  language: text("language").notNull().default("en"),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("persons_org_phone_key").on(t.organizationId, t.phoneE164),
  index("persons_org_role_idx").on(t.organizationId, t.role),
]);

/** One live conversation state per person — DB-backed, never in memory (§5). */
export const conversationStates = pgTable("conversation_states", {
  personId: uuid("person_id")
    .primaryKey()
    .references(() => persons.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  state: text("state").notNull().default("idle"), // idle | awaiting_task_choice | awaiting_reading | awaiting_photo |
  // awaiting_checklist_step | awaiting_problem_text | awaiting_problem_asset | awaiting_refill_confirm
  context: jsonb("context").notNull().default({}), // task_id, step index, parsed refill draft…
  expiresAt: timestamp("expires_at", { withTimezone: true }), // idle states carry NULL
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("conversation_states_expiry_idx").on(t.expiresAt)]);

/* --------------------------- message transport ------------------------- */

/**
 * Every inbound and outbound WhatsApp-shaped message. wa_message_id unique —
 * the webhook dedupes on it (Meta delivers events more than once, §9).
 * simulator rows carry a locally-minted id instead.
 */
export const messageLog = pgTable("message_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  waMessageId: text("wa_message_id").notNull(),
  direction: text("direction").notNull(), // 'in' | 'out'
  personId: uuid("person_id").references(() => persons.id, { onDelete: "set null" }),
  toPhone: text("to_phone"), // outbound target ('in' rows use person's number)
  type: text("type").notNull().default("text"), // text | interactive | template | media
  body: text("body"),
  mediaId: text("media_id"),
  templateName: text("template_name"),
  buttonsPayload: jsonb("buttons_payload"),
  status: text("status").notNull().default("received"), // received | sent | delivered | read | failed
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("message_log_wa_id_key").on(t.waMessageId),
  index("message_log_person_time_idx").on(t.personId, t.createdAt),
  index("message_log_org_time_idx").on(t.organizationId, t.createdAt),
]);

/* ------------------------------ assets --------------------------------- */

/** Demo Kitchen's three assets. Standalone in Custos (VIDE integration is a marked stub, §2). */
export const assets = pgTable("assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("other"), // fridge | generator | gas_cylinder | tool | other
  criticality: text("criticality").notNull().default("B"), // A | B | C (drives problem urgency, §4.5)
  note: text("note"),
  videDeviceName: text("vide_device_name"), // STUB: reserved for the future VIDE sensor link
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("assets_org_name_key").on(t.organizationId, t.name)]);

/* --------------------------- tasks + evidence -------------------------- */

/** Task templates: what repeats. steps/escalation rules live as JSON until UI needs more. */
export const taskTemplates = pgTable("task_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  taskType: taskTypeEnum("task_type").notNull().default("simple_done"),
  steps: jsonb("steps").notNull().default([]), // checklist: [{title, proof:'none'|'photo'|'number'}…]
  repeatRule: jsonb("repeat_rule"), // {kind:'daily'|'weekly'|'once', dayOfWeek?, timeLagos?}
  escalationRule: jsonb("escalation_rule").default({}), // {remindAfterMin, supervisorAfterMin, ownerAfterMin} — demo-speed switch compresses these
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
  dueTime: text("due_time"), // "07:30" Africa/Lagos for daily templates
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("task_templates_org_idx").on(t.organizationId)]);

/**
 * Concrete task instances. The scheduler advances escalation_level exactly
 * once per level (idempotency, §7); overdue tasks can only be closed with a
 * reason (§4.4) — reason rides on the evidence/text of the closing interaction.
 */
export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").references(() => taskTemplates.id, { onDelete: "set null" }),
  assigneeId: uuid("assignee_id").references(() => persons.id, { onDelete: "set null" }),
  title: text("title"), // snapshot of the template title at creation time
  taskType: taskTypeEnum("task_type").notNull().default("simple_done"),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  status: taskStatusEnum("status").notNull().default("pending"),
  escalateToOwner: boolean("escalate_to_owner").notNull().default(false),
  escalationLevel: integer("escalation_level").notNull().default(0),
  lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("tasks_org_due_idx").on(t.organizationId, t.dueAt),
  index("tasks_assignee_status_idx").on(t.assigneeId, t.status),
  index("tasks_status_due_idx").on(t.status, t.dueAt),
]);

/** Proof trail per task (and per checklist step): photo / number / text. */
export const evidence = pgTable("evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  step: integer("step"), // checklist step index; null for single-step tasks
  kind: evidenceKindEnum("kind").notNull(),
  value: text("value"), // the reading ("4"), the reason text…
  mediaUrl: text("media_url"), // storage key of the stored photo (never the raw media id, which expires)
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("evidence_task_idx").on(t.taskId)]);

/* ------------------------- problems -> jobs ----------------------------- */

/**
 * A problem reported by any registered person, turned into a job for the
 * technician (§4.5). jobs stay IN this table until M5 (assign + close with
 * photo + cost) — no separate marketplace table in the demo.
 */
export const problemReports = pgTable("problem_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  reporterId: uuid("reporter_id").references(() => persons.id, { onDelete: "set null" }),
  assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  photoMediaUrl: text("photo_media_url"),
  priority: problemPriorityEnum("priority").notNull().default("normal"),
  status: text("status").notNull().default("open"), // open | assigned | closed
  assignedToId: uuid("assigned_to_id").references(() => persons.id, { onDelete: "set null" }), // the technician
  closedWithPhotoUrl: text("closed_with_photo_url"),
  costKobo: integer("cost_kobo"), // what the repair cost, when the technician closes
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("problem_reports_org_status_idx").on(t.organizationId, t.status)]);

/* --------------------------- readings + gas ----------------------------- */

/** Machine-readable readings (fridge temps, gas kg, run hours). Persons supply some; sensors would too. */
export const readings = pgTable("readings", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  kind: readingKindEnum("kind").notNull(),
  value: numeric("value", { precision: 12, scale: 2 }).notNull(),
  unit: text("unit").notNull(), // degC | kg | hours — display vocabulary stays honest
  source: text("source").notNull().default("person"), // person | sensor
  byPersonId: uuid("by_person_id").references(() => persons.id, { onDelete: "set null" }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("readings_org_asset_idx").on(t.organizationId, t.assetId, t.at),
]);

/** Supervisor logs refills "refill 12.5 kg 18000" — cost in NGN, stored in kobo. */
export const gasRefills = pgTable("gas_refills", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  kg: numeric("kg", { precision: 10, scale: 2 }).notNull(),
  costKobo: integer("cost_kobo"),
  byPersonId: uuid("by_person_id").references(() => persons.id, { onDelete: "set null" }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("gas_refills_org_asset_idx").on(t.organizationId, t.assetId, t.at)]);

/* ----------------------------- audit + digests -------------------------- */

/** Append-only audit events — always insert, never update/delete (§6, §10). */
export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  actorKind: text("actor_kind").notNull().default("user"), // user | person | system | agent | webhook
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorPersonId: uuid("actor_person_id").references(() => persons.id, { onDelete: "set null" }),
  action: text("action").notNull(), // person.added, consent.started, task.completed, problem.reported, refill.logged…
  entity: text("entity").notNull(),
  entityId: text("entity_id").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_events_org_time_idx").on(t.organizationId, t.at)]);

/** Precomputed owner digests — metrics JSON by SQL/TS code, never an LLM's numbers (§8). */
export const digests = pgTable("digests", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  period: text("period").notNull(), // daily | weekly
  periodFrom: date("period_from").notNull(),
  periodTo: date("period_to").notNull(),
  metrics: jsonb("metrics").notNull(),
  summaryText: text("summary_text"),
  summarySource: text("summary_source").notNull().default("template"), // template | llm (validated) 
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("digests_org_period_idx").on(t.organizationId, t.periodFrom)]);

/* --------------------------------------------------------------------------
 * Base tenancy tables (same shape as the Planner — accounts port is deliberate
 * so the M0 overwrite fix ships here from day one: creation is INSERT-only,
 * password resets are expiring single-use tokens).
 * ----------------------------------------------------------------------- */
export type { Organization, User, Membership } from "./base";
export type Person = typeof persons.$inferSelect;
export type TaskTemplate = typeof taskTemplates.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type MessageRow = typeof messageLog.$inferSelect;
export { organizations, users, memberships, userAuthIdentities, passwordResetTokens } from "./base";
