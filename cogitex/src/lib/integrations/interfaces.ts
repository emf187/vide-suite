import type { Role, Urgency } from "@/lib/shared/types";

/**
 * Integration interfaces — exact mirror of docs/INTEGRATION_CONTRACTS.md.
 * Confidence markers (VERIFIED / PROPOSED) in comments come from that document.
 * Mock adapters live in src/lib/integrations/adapters/mock; swapping to real
 * adapters later is a config change, never a UI change.
 */

/* ---------- VIDE: live device / telemetry layer ---------- */

export type VideHealthStatus = "critical" | "warning" | "watch" | "healthy";

/** VERIFIED (in index.html console): console-side score mapping. */
export const HEALTH_SCORE: Record<VideHealthStatus, number> = {
  critical: 20,
  warning: 50,
  watch: 75,
  healthy: 100,
};

export interface VideMachineRecord {
  machineName: string;
  healthStatus: VideHealthStatus;
}

export interface VideReading {
  timestamp: string;
  powerKw: number | null;
  loadFactorPct: number | null;
  temperatureC: number | null;
  vibrationMmS: number | null;
  voltageV: number | null;
  currentAmps: number | null;
  powerFactor: number | null;
  frequencyHz: number | null;
}

export interface VideCriticalEvent {
  description?: string;
  faultType: string;
  machineName: string;
  flaggedAt: string;
}

export interface HealthSummary {
  score: number;
  status: VideHealthStatus | "unknown";
  statusLabel?: string;
  rul?: {
    estimateHours: number;
    uncertaintyHours: number;
    basis: "model" | "rules";
    affecting: string[];
  };
  samples?: { at: string; score: number }[];
  asOf: string;
}

export interface EnergySummaryParams {
  machineName: string;
  from: string;
  to: string;
  bucket?: "day" | "week";
}

export interface EnergySummary {
  buckets: { at: string; kwh: number; avgPowerKw: number; costEstimate?: number }[];
  powerQuality?: { at: string; eventType: "voltage_sag" | "swell" | "interruption"; detail?: string }[];
}

export interface RuntimeHours {
  totalHours: number;
  since: string;
  confidence: "metered" | "estimated";
}

export interface FaultHistoryParams {
  machineName?: string;
  from?: string;
  to?: string;
  severity?: "info" | "warning" | "high" | "critical";
}

export interface DeviceStatus {
  deviceId: string;
  machineName?: string;
  online: boolean;
  lastSeen?: string;
  batteryPct?: number;
  firmware?: string;
}

export interface LifecycleNoticeInput {
  machineName: string;
  action: "decommission" | "reactivate";
  effectiveAt?: string;
  reason?: string;
  requestedBy: { userId: string; name: string };
  orgRef: string;
}

export interface LifecycleNoticeAck {
  accepted: boolean;
  ingestionReleasedFrom?: string;
  deviceReleaseAt?: string;
}

export interface VideClient {
  getDetailedHealth(): Promise<{ status: string; factory?: { name: string | null } }>; // VERIFIED
  listMachines(): Promise<VideMachineRecord[]>; // VERIFIED
  getRecentReadings(machineName: string, limit: number): Promise<VideReading[]>; // VERIFIED
  listCriticalEvents(limit: number): Promise<VideCriticalEvent[]>; // VERIFIED
  getMachineHealthSummary(machineName: string, window: "h24" | "d7" | "d30"): Promise<HealthSummary>; // PROPOSED
  getEnergySummary(params: EnergySummaryParams): Promise<EnergySummary>; // PROPOSED
  getRuntimeHours(machineName: string, since?: string): Promise<RuntimeHours>; // PROPOSED
  listFaultHistory(params: FaultHistoryParams): Promise<VideCriticalEvent[]>; // PROPOSED
  getDevicesStatus(deviceIds: string[]): Promise<DeviceStatus[]>; // PROPOSED
  postLifecycleNotice(input: LifecycleNoticeInput): Promise<LifecycleNoticeAck>; // §5 write-out
}

/* ---------- Cortex: health intelligence + feedback ---------- */

export interface RulEstimate {
  estimateHours: number;
  uncertaintyHours: number;
  basis: "model" | "rules";
  topFactors: string[];
  asOf: string;
}

export interface ConfirmedRootCauseInput {
  eventId: string;
  rootCauseCode: string | null;
  rootCauseText: string;
  workOrderNumber: string;
  confirmedBy: { userId: string; name: string };
  completedAt: string;
}

export interface CortexClient {
  getRulEstimate(machineName: string): Promise<RulEstimate | null>; // PROPOSED
  /** PROPOSED write-back (idempotent by event id) so VIDE can improve fault models. */
  sendConfirmedRootCause(input: ConfirmedRootCauseInput): Promise<void>;
}

/* ---------- Marketplace: Verified Technicians ---------- */

export type SkillLevel = "none" | "basic" | "intermediate" | "specialist";

export interface RepairBrief {
  machineSnapshot: Record<string, unknown>;
  fault?: { type: string; severity: "info" | "warning" | "high" | "critical"; confidence?: number; description?: string; flaggedAt?: string };
  healthTrend?: { at: string; score: number }[];
  suggestedParts: { sku: string; qty: number }[];
  tools: string[];
  skill: SkillLevel;
  urgency: Urgency;
  notes?: string;
}

export interface RepairRequestDraft {
  localRequestId: string;
  orgRef: string;
  brief: RepairBrief;
}

export type MarketplaceRequestStatus =
  | "sent"
  | "matched"
  | "quoted"
  | "accepted"
  | "en_route"
  | "on_site"
  | "completed"
  | "declined"
  | "withdrawn"
  | "failed";

export interface MarketplaceRequestStatusInfo {
  requestId: string;
  status: MarketplaceRequestStatus;
  technician?: { id: string; name: string; rating?: number };
  quoteKobo?: number;
  etaAt?: string;
  outcomeSummary?: string;
}

export interface TechnicianProfile {
  id: string;
  displayName: string;
  skills: string[];
  ratingAvg?: number;
  jobsCompleted: number;
  verifiedAt?: string;
}

export interface MarketplaceClient {
  createRepairRequest(input: RepairRequestDraft): Promise<{ marketplaceRequestId: string; sentAt: string }>;
  cancelRepairRequest(requestId: string, reason: string, byUserId: string): Promise<void>;
  getRequestStatus(requestId: string): Promise<MarketplaceRequestStatusInfo>;
  listTechnicians(params: { skills?: string[] }): Promise<TechnicianProfile[]>;
  submitRating(input: { marketplaceRequestId: string; rating: 1 | 2 | 3 | 4 | 5; note?: string }): Promise<void>;
}

/* ---------- Notifications ---------- */

export type NotificationChannel = "in_app" | "email" | "push" | "whatsapp" | "sms";

export interface NotificationInput {
  orgId: string;
  userId: string;
  channel: NotificationChannel;
  kind: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  dedupeKey?: string;
}

export interface NotificationClient {
  send(input: NotificationInput): Promise<"queued" | "sent" | "skipped">;
  health(): Promise<{ provider: string; ok: boolean }>;
}

/* ---------- Identity ---------- */

export interface SessionContext {
  user: { id: string; name: string; email: string; phone?: string };
  organization: { id: string; slug: string; name: string; currency: string; timezone: string };
  memberships: { orgId: string; role: Role }[];
}

export interface OrgMember {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

export interface ExternalActorBind {
  membershipId: string;
  marketplaceTechnicianId: string;
}

export interface IdentityClient {
  authenticate(strategy: "password" | "magic_link" | "shared_sso"): Promise<SessionContext>;
  listUsers(orgId: string): Promise<OrgMember[]>;
  registerExternalActor(input: { marketplaceTechnicianId: string }): Promise<ExternalActorBind>;
}
