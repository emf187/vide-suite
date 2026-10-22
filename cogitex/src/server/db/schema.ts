/**
 * M0 schema slice: tenancy + identity (see docs/DATA_MODEL.md for the full model).
 * Each later milestone adds its own tables (machines in M1, work orders in M2, ...).
 * Conventions: snake_case SQL names, money = integer kobo, timestamps = timestamptz UTC.
 */
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  customType,
} from "drizzle-orm/pg-core";

/** bytea for DB-backed document storage (demo-friendly, works on Vercel) */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const userRoleEnum = pgEnum("user_role", [
  "owner",
  "admin",
  "maintenance_manager",
  "technician",
  "viewer",
  "external_technician",
]);

export const machineLifecycleEnum = pgEnum("machine_lifecycle", [
  "commissioned",
  "active",
  "standby",
  "under_maintenance",
  "decommissioned",
]);

export const documentKindEnum = pgEnum("document_kind", [
  "manual",
  "datasheet",
  "drawing",
  "photo",
  "procedure",
  "warranty",
  "calibration_cert",
  "report",
  "other",
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  currency: text("currency").notNull().default("NGN"),
  timezone: text("timezone").notNull().default("Africa/Lagos"),
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("organizations_slug_key").on(t.slug)]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  locale: text("locale").notNull().default("en"),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("users_email_key").on(t.email)]);

export const userAuthIdentities = pgTable("user_auth_identities", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // 'password' | 'magic_link' | 'shared_sso'
  subject: text("subject").notNull(), // e.g. the email for the 'password' provider
  passwordHash: text("password_hash"), // scrypt envelope; null for SSO-provided identities
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("user_auth_identities_provider_subject_key").on(t.provider, t.subject)]);

export const memberships = pgTable("memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: userRoleEnum("role").notNull().default("viewer"),
  isActive: boolean("is_active").notNull().default(true),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("memberships_org_user_key").on(t.organizationId, t.userId),
  index("memberships_user_idx").on(t.userId),
  index("memberships_org_idx").on(t.organizationId),
]);

/**
 * Append-only audit trail (docs/DATA_MODEL.md §3.10). Never UPDATE/DELETE here;
 * enforced in code (the app calls insert-only paths) and by CI repo rules.
 */
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorKind: text("actor_kind").notNull().default("user"), // 'user' | 'system' | 'agent' | 'webhook'
  action: text("action").notNull(), // e.g. 'org.created', 'user.signed_up'
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  diff: jsonb("diff"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  requestId: text("request_id"),
  ipHash: text("ip_hash"),
}, (t) => [index("audit_logs_org_time_idx").on(t.organizationId, t.occurredAt)]);

// Exported types for app code
export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;

/** Union of the pgEnum roles (kept in sync with lib/shared/types.ts). */
export type DbRole = (typeof userRoleEnum.enumValues)[number];

/* =====================================================================
 * M1 — Machine registry (docs/DATA_MODEL.md §3.1, §3.3, documents §3.5)
 * ===================================================================== */

export const sites = pgTable("sites", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  address: text("address"),
  notes: text("notes"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("sites_org_code_key").on(t.organizationId, t.code)]);

export const areas = pgTable("areas", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  kind: text("kind").notNull().default("area"), // 'area' | 'line'
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("areas_org_site_code_key").on(t.organizationId, t.siteId, t.code)]);

export const machines = pgTable("machines", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),
  areaId: uuid("area_id").references(() => areas.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  tag: text("tag").notNull(), // e.g. PUMP-3 — unique per org (case-insensitive)
  category: text("category").notNull(), // pump, motor, generator, ...
  make: text("make"),
  model: text("model"),
  serialNumber: text("serial_number"),
  ratedSpecs: jsonb("rated_specs").notNull().default({}),
  installDate: date("install_date"),
  warrantyUntil: date("warranty_until"),
  criticality: text("criticality").notNull().default("B"), // A | B | C
  locationNote: text("location_note"),
  lifecycleStatus: machineLifecycleEnum("lifecycle_status").notNull().default("commissioned"),
  decommission: jsonb("decommission"), // {reason, effectiveAt, partsDisposition, openWoPolicy}
  runtimeHours: numeric("runtime_hours", { precision: 12, scale: 1 }).notNull().default("0"),
  runtimeBaseOffset: numeric("runtime_base_offset", { precision: 12, scale: 1 }).notNull().default("0"),
  profileSnapshot: jsonb("profile_snapshot"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("machines_org_tag_key").on(t.organizationId, t.tag),
  index("machines_org_status_idx").on(t.organizationId, t.lifecycleStatus),
  index("machines_org_site_idx").on(t.organizationId, t.siteId),
]);

/** Mapping to VIDE machines/devices — the app owns this join (brief §3). */
export const machineDevices = pgTable("machine_devices", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  machineId: uuid("machine_id").notNull().references(() => machines.id, { onDelete: "cascade" }),
  videMachineName: text("vide_machine_name").notNull(),
  videDeviceId: text("vide_device_id"),
  kind: text("kind").notNull().default("machine"),
  statusCache: jsonb("status_cache"),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  unlinkedAt: timestamp("unlinked_at", { withTimezone: true }),
}, (t) => [index("machine_devices_machine_idx").on(t.machineId)]);

/** BOM components (physical assemblies/subassemblies of a machine). */
export const machineComponents = pgTable("machine_components", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  machineId: uuid("machine_id").notNull().references(() => machines.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tag: text("tag"),
  kind: text("kind").notNull().default("assembly"), // motor, bearing_housing, seal, ...
  locationNote: text("location_note"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("machine_components_machine_idx").on(t.machineId)]);

/** Append-only lifecycle history with VIDE call acknowledgement. */
export const machineLifecycleLog = pgTable("machine_lifecycle_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  machineId: uuid("machine_id").notNull().references(() => machines.id, { onDelete: "cascade" }),
  fromStatus: machineLifecycleEnum("from_status"),
  toStatus: machineLifecycleEnum("to_status").notNull(),
  reason: text("reason"),
  effectiveAt: timestamp("effective_at", { withTimezone: true }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  videCallStatus: text("vide_call_status").notNull().default("skipped"), // 'acknowledged' | 'failed' | 'skipped' | 'not_applicable'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("machine_lifecycle_log_machine_idx").on(t.machineId, t.createdAt)]);

/** Documents metadata; the bytes live in document_blobs (DB-backed storage adapter). */
export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  machineId: uuid("machine_id").references(() => machines.id, { onDelete: "cascade" }),
  workOrderId: uuid("work_order_id"),
  inventoryItemId: uuid("inventory_item_id"),
  repairRequestId: uuid("repair_request_id"),
  reportId: uuid("report_id"),
  kind: documentKindEnum("kind").notNull().default("other"),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  checksumSha256: text("checksum_sha256"),
  scanStatus: text("scan_status").notNull().default("unscanned"), // 'clean' | 'quarantined' | 'unscanned'
  uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("documents_machine_idx").on(t.machineId)]);

export const documentBlobs = pgTable("document_blobs", {
  documentId: uuid("document_id").primaryKey().references(() => documents.id, { onDelete: "cascade" }),
  bytes: bytea("bytes").notNull(),
});

/** CSV import staging (dry-run → confirm two-step). */
export const importStaging = pgTable("import_staging", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'machines' | 'inventory_items' (inventory lands in M3)
  rows: jsonb("rows").notNull(),
  validCount: integer("valid_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending"), // 'pending' | 'committed' | 'discarded'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* =====================================================================
 * M2 — Planning: templates, schedules, work orders (DATA_MODEL §3.6–3.9)
 * ===================================================================== */

export const workOrderStatusEnum = pgEnum("work_order_status", [
  "draft",
  "planned",
  "assigned",
  "in_progress",
  "on_hold",
  "completed",
  "verified",
  "closed",
  "cancelled",
]);

export const scheduleKindEnum = pgEnum("schedule_kind", ["calendar", "runtime", "condition"]);

export const maintenanceTemplates = pgTable("maintenance_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  machineCategory: text("machine_category"), // 'pump' etc, null = any
  defaultIntervalDays: integer("default_interval_days"),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("maintenance_templates_org_idx").on(t.organizationId)]);

export const templateSteps = pgTable("template_steps", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").notNull().references(() => maintenanceTemplates.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("check"), // 'check' | 'value' | 'photo'
  requireValue: boolean("require_value").notNull().default(false),
  requirePhoto: boolean("require_photo").notNull().default(false),
  helpText: text("help_text"),
}, (t) => [index("template_steps_template_idx").on(t.templateId, t.seq)]);

export const schedules = pgTable("schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  machineId: uuid("machine_id").references(() => machines.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").references(() => maintenanceTemplates.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  kind: scheduleKindEnum("kind").notNull().default("calendar"),
  /** calendar cadence in days (7/30/90/180/365 typical) */
  intervalDays: integer("interval_days"),
  /** runtime trigger: work order when machine accumulates N hours since last run */
  runtimeTriggerHours: numeric("runtime_trigger_hours", { precision: 10, scale: 1 }),
  /** metered runtime (machine.runtimeHours) when the last run happened — the baseline for "since" */
  runtimeBaselineHours: numeric("runtime_baseline_hours", { precision: 12, scale: 1 }),
  /** condition trigger: metric across a threshold (mock metrics today, VIDE in M4) */
  conditionMetric: text("condition_metric"), // 'vibration_mm_s' | 'temperature_c'
  conditionOp: text("condition_op"), // '>' | '<'
  conditionThreshold: numeric("condition_threshold", { precision: 10, scale: 2 }),
  partsPlan: jsonb("parts_plan"), // [{sku, qty}] attached to generated WOs in M3
  active: boolean("active").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextDueAt: timestamp("next_due_at", { withTimezone: true }),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("schedules_org_active_idx").on(t.organizationId, t.active),
  index("schedules_machine_idx").on(t.machineId),
]);

/** PM generation history: why a work order exists (schedule run). */
export const scheduleRuns = pgTable("schedule_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  scheduleId: uuid("schedule_id").notNull().references(() => schedules.id, { onDelete: "cascade" }),
  machineId: uuid("machine_id").references(() => machines.id, { onDelete: "set null" }),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
  triggerBasis: text("trigger_basis"), // 'calendar' | 'runtime' | 'condition' + observed value
  workOrderId: uuid("work_order_id"),
  status: text("status").notNull().default("generated"), // 'generated' | 'skipped' | 'failed'
  reason: text("reason"),
}, (t) => [index("schedule_runs_org_idx").on(t.organizationId, t.triggeredAt)]);

export const workOrders = pgTable("work_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** unique per org, allocated from org_counters; human-identifiable (WO-000001) */
  number: text("number").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  machineId: uuid("machine_id").references(() => machines.id, { onDelete: "set null" }),
  type: text("type").notNull().default("corrective"), // corrective | preventive | inspection | installation
  priority: text("priority").notNull().default("normal"), // low | normal | high | critical
  status: workOrderStatusEnum("status").notNull().default("draft"),
  assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
  templateId: uuid("template_id").references(() => maintenanceTemplates.id, { onDelete: "set null" }),
  scheduleId: uuid("schedule_id").references(() => schedules.id, { onDelete: "set null" }),
  source: text("source").notNull().default("manual"), // manual | schedule | agent | import
  plannedStart: timestamp("planned_start", { withTimezone: true }),
  plannedEnd: timestamp("planned_end", { withTimezone: true }),
  actualStart: timestamp("actual_start", { withTimezone: true }),
  actualEnd: timestamp("actual_end", { withTimezone: true }),
  downtimeHours: numeric("downtime_hours", { precision: 10, scale: 1 }),
  completedSummary: text("completed_summary"),
  foundRootCause: text("found_root_cause"),
  verifiedBy: uuid("verified_by").references(() => users.id, { onDelete: "set null" }),
  cancelledReason: text("cancelled_reason"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("work_orders_org_number_key").on(t.organizationId, t.number),
  index("work_orders_org_status_idx").on(t.organizationId, t.status),
  index("work_orders_machine_idx").on(t.machineId),
  index("work_orders_assignee_idx").on(t.assignedTo),
]);

export const workOrderSteps = pgTable("work_order_steps", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workOrderId: uuid("work_order_id").notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("check"),
  requireValue: boolean("require_value").notNull().default(false),
  requirePhoto: boolean("require_photo").notNull().default(false),
  value: text("value"),
  photoDocumentId: uuid("photo_document_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: uuid("completed_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [index("work_order_steps_wo_idx").on(t.workOrderId, t.seq)]);

export const workOrderLabor = pgTable("work_order_labor", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workOrderId: uuid("work_order_id").notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  minutes: integer("minutes").notNull(),
  rateKobo: integer("rate_kobo").notNull().default(250000), // ₦2,500/hr default; part of cost rollup
  note: text("note"),
  loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("work_order_labor_wo_idx").on(t.workOrderId)]);

/** Parts reserved/consumed against work orders — wired to the ledger in M3. */
export const workOrderParts = pgTable("work_order_parts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  workOrderId: uuid("work_order_id").notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  inventoryItemId: uuid("inventory_item_id"),
  name: text("name"), // free-text part line when inventory item is not chosen (M3 links it)
  qty: numeric("qty", { precision: 12, scale: 2 }).notNull().default("1"),
  /** unit cost captured at issue time (integer kobo) so the card cost is immutable history */
  unitCostKobo: integer("unit_cost_kobo").notNull().default(0),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  issuedBy: uuid("issued_by").references(() => users.id, { onDelete: "set null" }),
  note: text("note"),
}, (t) => [index("work_order_parts_wo_idx").on(t.workOrderId)]);

/** Per-org, per-kind counters for human numbering (WO-000001). Composite key, row-locked on allocation. */
export const orgCounters = pgTable("org_counters", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  lastValue: integer("last_value").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.organizationId, t.kind] })]);

/* ---------------------------------------------------------------------------
 * M3 — Inventory: items, suppliers, append-only stock ledger, reservations.
 * Physical stock lives ONLY here; receipts/issues/adjustments append ledger rows
 * and the item's on-hand moves with them. Reservations are commitments (not yet
 * physical); availability = on-hand − Σ open reservations.
 * ------------------------------------------------------------------------- */

export const suppliers = pgTable("suppliers", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  leadTimeDays: integer("lead_time_days"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("suppliers_org_idx").on(t.organizationId)]);

export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** SKU unique per org (case-sensitively compared, trimmed) */
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  category: text("category"), // bearings | seals | filters | oil | consumables | spares ...
  unit: text("unit").notNull().default("pcs"),
  qtyOnHand: numeric("qty_on_hand", { precision: 12, scale: 2 }).notNull().default("0"),
  reorderPoint: numeric("reorder_point", { precision: 12, scale: 2 }).notNull().default("0"),
  /** last known unit cost, integer kobo — issues cost cards with the value at issue time */
  unitCostKobo: integer("unit_cost_kobo").notNull().default(0),
  locationNote: text("location_note"),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("inventory_items_org_sku_key").on(t.organizationId, t.sku),
  index("inventory_items_org_active_idx").on(t.organizationId, t.active),
]);

/** Append-only stock movements. `kind`: receipt (+) | issue (−) | adjust (±) | return (+). */
export const stockLedger = pgTable("stock_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => inventoryItems.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // receipt | issue | adjust | return
  /** signed movement: positive into stock, negative out */
  qty: numeric("qty", { precision: 12, scale: 2 }).notNull(),
  unitCostKobo: integer("unit_cost_kobo").notNull().default(0),
  /** running on-hand after this movement (audit convenience) */
  balanceAfter: numeric("balance_after", { precision: 12, scale: 2 }).notNull(),
  workOrderId: uuid("work_order_id"),
  reference: text("reference"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("stock_ledger_org_created_idx").on(t.organizationId, t.createdAt),
  index("stock_ledger_item_idx").on(t.itemId, t.createdAt),
]);

/** Reservations: stock promised to a work order before it is physically issued. */
export const inventoryReservations = pgTable("inventory_reservations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => inventoryItems.id, { onDelete: "cascade" }),
  workOrderId: uuid("work_order_id").notNull().references(() => workOrders.id, { onDelete: "cascade" }),
  qty: numeric("qty", { precision: 12, scale: 2 }).notNull(),
  status: text("status").notNull().default("open"), // open | issued | cancelled
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("inventory_reservations_org_status_idx").on(t.organizationId, t.status),
  index("inventory_reservations_wo_idx").on(t.workOrderId),
  index("inventory_reservations_item_idx").on(t.itemId, t.status),
]);

/** Machine ← → part compatibility: which spare fits which machine (used by agents + reservations UX). */
export const machineParts = pgTable("machine_parts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  machineId: uuid("machine_id").notNull().references(() => machines.id, { onDelete: "cascade" }),
  inventoryItemId: uuid("inventory_item_id").notNull().references(() => inventoryItems.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("machine_parts_machine_idx").on(t.machineId),
  uniqueIndex("machine_parts_unique_idx").on(t.machineId, t.inventoryItemId),
]);

/* ---------------------------------------------------------------------------
 * M4 — VIDE webhook intake: persisted fault events + cached telemetry reads.
 * The webhook resolves machines strictly by *vide machine name within the
 * claimed org* — payload ids are never trusted. Health/energy go cache-through
 * so the UI is fast and the adapter is only hit when the TTL tells us to.
 * ------------------------------------------------------------------------- */

/** Fault/quality events pushed by VIDE (or synthesized by the mock profile). */
export const faultEvents = pgTable("fault_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  machineId: uuid("machine_id").references(() => machines.id, { onDelete: "cascade" }),
  /** the raw device name from the payload — kept verbatim for auditability */
  videMachineName: text("vide_machine_name").notNull(),
  faultType: text("fault_type").notNull(), // e.g. rising_vibration | voltage_sag | trip | overheating
  severity: text("severity").notNull().default("warning"), // critical | warning | watch
  description: text("description"),
  flaggedAt: timestamp("flagged_at", { withTimezone: true }).notNull().defaultNow(),
  /** the work order created from this fault (agent of record: convertToWorkOrder) */
  woId: uuid("wo_id").references(() => workOrders.id, { onDelete: "set null" }),
  status: text("status").notNull().default("open"), // open | acknowledged | converted | dismissed
  acknowledgedBy: uuid("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("fault_events_org_status_idx").on(t.organizationId, t.status),
  index("fault_events_org_created_idx").on(t.organizationId, t.createdAt),
  index("fault_events_machine_idx").on(t.machineId, t.status),
]);

/** Cache-through reads for VIDE telemetry keyed by (org, key) with fetch time. */
export const videCache = pgTable("vide_cache", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  key: text("key").notNull(), // health:PUMP-1:d7 | energy:PUMP-1:7d:day | readings:PUMP-1
  payload: jsonb("payload").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("vide_cache_org_key_key").on(t.organizationId, t.key)]);

export type FaultEvent = typeof faultEvents.$inferSelect;
export type VideCacheRow = typeof videCache.$inferSelect;

/* ------------------------------------------------------------------ */
/* M5 — repair marketplace (VIDE Verified Technicians)                 */
/* ------------------------------------------------------------------ */

/** Verified-technician directory, synced from marketplace status payloads. */
export const technicianProfiles = pgTable("technician_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  marketplaceTechnicianId: text("marketplace_technician_id").notNull(),
  displayName: text("display_name").notNull(),
  skills: jsonb("skills").$type<string[]>().notNull().default([]),
  ratingAvg: numeric("rating_avg", { precision: 3, scale: 2 }),
  jobsCompleted: integer("jobs_completed").notNull().default(0),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("technician_profiles_org_mid_key").on(t.organizationId, t.marketplaceTechnicianId)]);

/** Repair requests — compiled brief, human-confirmed BEFORE anything is sent. */
export const repairRequests = pgTable("repair_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  machineId: uuid("machine_id").references(() => machines.id, { onDelete: "set null" }),
  /** brief snapshot attached at send time (what was compiled + what the human edited) */
  machineSnapshot: jsonb("machine_snapshot"),
  faultEventId: uuid("fault_event_id").references(() => faultEvents.id, { onDelete: "set null" }),
  workOrderId: uuid("work_order_id").references(() => workOrders.id, { onDelete: "set null" }),
  /** compiled draft brief (before edits) */
  brief: jsonb("brief").notNull(),
  /** post-edit copy — what actually went out (confirm-before-send) */
  confirmedBrief: jsonb("confirmed_brief"),
  urgency: text("urgency").notNull().default("medium"), // low | medium | high | critical
  compiledBy: uuid("compiled_by").references(() => users.id, { onDelete: "set null" }),
  status: text("status").notNull().default("compiled"), // compiled | sent | matched | quoted | accepted | en_route | on_site | completed | confirmed | declined | withdrawn | failed
  marketplaceRequestId: text("marketplace_request_id"),
  technicianId: uuid("technician_id").references(() => technicianProfiles.id, { onDelete: "set null" }),
  quoteKobo: integer("quote_kobo"),
  quoteCurrency: text("quote_currency"),
  etaAt: timestamp("eta_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  enRouteAt: timestamp("en_route_at", { withTimezone: true }),
  onSiteAt: timestamp("on_site_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  outcomeSummary: text("outcome_summary"),
  rating: integer("rating"),
  ratingNote: text("rating_note"),
  cancelledReason: text("cancelled_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("repair_requests_org_status_idx").on(t.organizationId, t.status),
  index("repair_requests_org_machine_idx").on(t.organizationId, t.machineId),
  uniqueIndex("repair_requests_mrqid_key").on(t.marketplaceRequestId),
]);

/** Append-only status trail (webhook payloads + manual actions). */
export const repairRequestEvents = pgTable("repair_request_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  repairRequestId: uuid("repair_request_id").notNull().references(() => repairRequests.id, { onDelete: "cascade" }),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  payload: jsonb("payload"),
  actor: text("actor").notNull().default("webhook"), // marketplace | webhook | user | system
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("repair_request_events_req_idx").on(t.repairRequestId)]);

export type TechnicianProfile = typeof technicianProfiles.$inferSelect;
export type RepairRequest = typeof repairRequests.$inferSelect;
export type RepairRequestEvent = typeof repairRequestEvents.$inferSelect;

/* ------------------------------------------------------------------ */
/* M6 — reports (deterministic metrics; calc is code, never LLM)       */
/* ------------------------------------------------------------------ */

export const reports = pgTable("reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // machine_status | plant_summary
  scope: jsonb("scope").notNull().$type<{ machineId?: string | null; all?: boolean }>(),
  periodFrom: timestamp("period_from", { withTimezone: true }).notNull(),
  periodTo: timestamp("period_to", { withTimezone: true }).notNull(),
  periodDays: integer("period_days").notNull(),
  params: jsonb("params"),
  /** the computed metrics bundle — produced ONLY by src/server/metrics code (calc_version guard) */
  calc: jsonb("calc").notNull(),
  calcVersion: integer("calc_version").notNull().default(1),
  status: text("status").notNull().default("done"), // queued | generating | done | failed
  error: text("error"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [
  index("reports_org_generated_idx").on(t.organizationId, t.generatedAt),
]);

export type ReportRow = typeof reports.$inferSelect;

/* ------------------------------------------------------------------ */
/* M7 — agent tool logs (every call logged; writes are CONFIRM-gated)  */
/* ------------------------------------------------------------------ */

export const agentToolLogs = pgTable("agent_tool_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  /** read | write-proposed | write-executed | write-refused | error */
  status: text("status").notNull().default("read"),
  tool: text("tool").notNull(),
  /** model/local extracted invocation args */
  args: jsonb("args"),
  /** sanitized tool result (ids + labels only for write-proposed rows) */
  result: jsonb("result"),
  /** citation ids the answer cites (machine/wo/fault/sku/report/…) */
  citations: jsonb("citations").$type<{ kind: string; id: string; label: string }[]>().notNull().default([]),
  /** how the intent was matched: 'local' | 'llm' */
  via: text("via"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("agent_tool_logs_org_created_idx").on(t.organizationId, t.createdAt),
  index("agent_tool_logs_user_idx").on(t.userId),
]);

export type AgentToolLog = typeof agentToolLogs.$inferSelect;

export type WorkOrderPart = typeof workOrderParts.$inferSelect;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type StockLedgerRow = typeof stockLedger.$inferSelect;
export type InventoryReservation = typeof inventoryReservations.$inferSelect;
export type Supplier = typeof suppliers.$inferSelect;
export type WorkOrder = typeof workOrders.$inferSelect;
export type WorkOrderStep = typeof workOrderSteps.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type MaintenanceTemplate = typeof maintenanceTemplates.$inferSelect;

export type Site = typeof sites.$inferSelect;
export type Area = typeof areas.$inferSelect;
export type Machine = typeof machines.$inferSelect;
export type MachineComponent = typeof machineComponents.$inferSelect;
export type MachineLifecycleEntry = typeof machineLifecycleLog.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
