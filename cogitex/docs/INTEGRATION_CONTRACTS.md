# Cogitex Maintenance Planner — Integration Contracts

> **Status: PLANNING — awaiting approval.** Every cross-service interface this app consumes.
> Golden rules: treat as OBSERVED only what is visible in real code/artifacts; mark PROPOSED
> everywhere else and confirm before building against anything real. Until confirmed, we code to
> typed interfaces + mocks and never hard-code URLs or keys.

**Confidence legend**
- `VERIFIED` — read directly from the VIDE main app front-end (`vide manage/index.html`, lines referenced). Real shapes we can depend on (with tolerance for evolution).
- `PROPOSED` — we need it but haven't seen it; VIDE/Cortex/marketplace must build or confirm. These become the input spec for those services.
- `EXTENDS A VERIFIED SHAPE` — built on an observed endpoint with additional, plausible fields we must confirm.

---

## 1. Environment configuration (no hard-coded values)

```ini
# from .env.example (names only)
VIDE_API_BASE_URL=            # e.g. http://127.0.0.1:8000/api — observed default in the console input
VIDE_INTEGRATION_BASE_URL=    # optional separate service host for /integration endpoints (proposed)
VIDE_WEBHOOK_SECRET=          # HMAC-SHA256 shared secret for webhooks → us
VIDE_HMAC_HEADER=X-Cogitex-Signature
VIDE_TIMESTAMP_HEADER=X-Cogitex-Timestamp
CORTEX_API_BASE_URL=          # diagnostics/ML service (may equal VIDE_API_BASE_URL — confirm)
CORTEX_API_KEY=
MARKETPLACE_API_BASE_URL=
MARKETPLACE_API_KEY=
MARKETPLACE_WEBHOOK_SECRET=
IDENTITY_SERVICE_URL=         # future shared SSO; empty = built-in auth
NOTIFICATION_SERVICE_URL=     # shared push/WhatsApp/SMS relay
LLM_PROVIDER=                 # e.g. 'openai-compat'
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
DATABASE_URL=UPLOAD_STORAGE_BACKEND=   # 'local' | 's3'
UPLOAD_SCANNER_HOOK_URL=      # optional antivirus scanner
```

HTTP client defaults for every adapter: 8s timeout, 2 retries with exponential backoff on 5xx/network,
circuit breaker (5 consecutive failures → open 30s), request-id propagation, structured error type
`{code, retryable, status?, detail}`. **No telemetry polling loops inside the adapter layer** — the
scheduler + TanStack Query own timing.

---

## 2. VideClient — live device/telemetry layer

**VERIFIED (from index.html):** the VIDE console consumes a REST API at `VIDE_API_BASE_URL`:

| Endpoint | Shape (VERIFIED) |
|---|---|
| `GET /health/detailed` | `{ status: "ok"\|…, factory?: { name: string } }` |
| `GET /machines` | `Array<{ machine_name: string, health_status: "critical"\|"warning"\|"watch"\|"healthy" }>` |
| `GET /readings/recent/{machine_name}?limit=N` | `Array<Reading>` where `Reading = { timestamp: string, power_kw: number \| null, load_factor_pct: number \| null, temperature_c: number \| null, vibration_mm_s: number \| null, voltage_v: number \| null, current_amps: number \| null, power_factor: number \| null, frequency_hz: number \| null }` |
| `GET /diagnostics/critical-events?limit=N` | `Array<{ description?: string, fault_type: string, machine_name: string, flagged_at: string }>` |
| `POST /diagnostics/analyze` | req: `{ machine_name, machine_type, rated_load_kw, voltage_v, current_amps, power_kw, power_factor, frequency_hz, use_llm?: boolean, force_ml?: boolean }` → resp: `{ primary_fault?: { type }, ml_prediction?: { fault_type, fault_type_confidence, hours_to_maintenance, top_factors: string[] }, fused_diagnosis: { overall_urgency: "none"\|"low"\|"medium"\|"high"\|"critical", agreement: string } }` |
| `POST /api/readings` | firmware ingest — VIDE-owned; we never call it |

Console behaviors we mirror client-side (documented so we replicate semantics, not guesswork):
- Health score mapping used by the console:
  `healthy→100, watch→75, warning→50, critical→20`.
- "Online" heuristic: latest reading `timestamp` within 60s of poll time.
- 3s poll cadence (ours: 15–30s server cache + TTL; we are documentation-first, not a live console).

**Regarding PROPOSED additions** (we need these for M1+/M4; the console only proves the above):

| Contract | Why we need it | Proposed shape |
|---|---|---|
| Machine directory + device mapping | tag↔`machine_name` mapping lives in our app; device ids power pairing status | `GET /integration/machines` → `{ machines: [{ machine_name, display_name?, machine_type?, device_ids: [{device_id, kind}], health_status, last_seen? }] }` (EXTENDS A VERIFIED SHAPE) |
| Health detail/score/RUL | Health tab needs numeric score + trend + RUL beyond 4 statuses | `GET /integration/machines/{machine_name}/health/summary?window=h24\|d7\|d30` → `{ score: 0–100, status, status_label, rul?: { estimate_hours, uncertainty_hours, affecting: string[] }, samples?: [{ at, score }], as_of }` (PROPOSED) |
| Energy summaries | Energy tab + reports (§ VIDE owns metering; we show summaries only) | `GET /integration/energy/summary?machine_name={tag}&from&to&bucket=day` → `{ buckets: [{ at, kwh, avg_power_kw, cost_estimate? }], power_quality: [{ at, event_type ("voltage_sag"\|"swell"\|"interruption"), detail? }] }` (PROPOSED) |
| Runtime hours | runtime-hours-based PM schedules (brief 5.2/§4) | `GET /integration/machines/{machine_name}/runtime-hours?since` → `{ total_hours, since, confidence: 'metered'\|'estimated' }` (PROPOSED) |
| Fault history | machine profile fault tab without webhook replay | `GET /integration/faults?machine_name={tag}&from&to&severity` — page of events with the same shape as the webhooks in §4 (PROPOSED) |
| Device status | linkage health display | `GET /integration/devices/status?ids=…` → `[{ device_id, machine_name?, online: bool, last_seen, battery_pct?, firmware? }]` (PROPOSED) |
| Health trend for briefs | repair-request auto-compilation | `GET /integration/machines/{machine_name}/health/trend?window=d14` (subset of the health/summary contract above is acceptable) (PROPOSED) |

**TS interface (this app):**

```ts
export type VideHealthStatus = 'critical' | 'warning' | 'watch' | 'healthy';
export const HEALTH_SCORE: Record<VideHealthStatus, number> =
  { critical: 20, warning: 50, watch: 75, healthy: 100 };

export interface VideClient {
  getDetailedHealth(): Promise<{ status: string; factory?: { name: string | null } }>;        // VERIFIED
  listMachines(): Promise<VideMachineRecord[]>;                                               // VERIFIED
  getRecentReadings(machineName: string, limit: number): Promise<VideReading[]>;               // VERIFIED
  listCriticalEvents(limit: number): Promise<VideCriticalEvent[]>;                             // VERIFIED
  getMachineHealthSummary(machineName: string, window: 'h24' | 'd7' | 'd30'):
    Promise<HealthSummary>;                                                                   // PROPOSED
  getEnergySummary(params: EnergySummaryParams): Promise<EnergySummary>;                       // PROPOSED
  getRuntimeHours(machineName: string, since?: Date): Promise<RuntimeHours>;                   // PROPOSED
  listFaultHistory(params: FaultHistoryParams): Promise<FaultEvent[]>;
  getDevicesStatus(deviceIds: string[]): Promise<DeviceStatus[]>;
  postLifecycleNotice(input: LifecycleNoticeInput): Promise<LifecycleNoticeAck>;               // §5 write
}
```

Map `machine_name` ↔ machine here (never ask the model to). Our mapping table: `machine_devices`.

---

## 3. CortexClient — health intelligence + feedback

Cortex is VIDE's machine-intelligence engine (the console brands it "VIDE CORTEX" and exposes it
via `/diagnostics/*` (VERIFIED)). We consume:

| Contract | Status | Shape |
|---|---|---|
| `GET /integration/machines/{machine_name}/rul` | PROPOSED | `{ estimate_hours, uncertainty_hours, basis ("model"|"rules"), top_factors: string[], as_of }` |
| `POST /integration/faults/{event_id}/confirmed-root-cause` | PROPOSED (write-back) | req `{ root_cause_code: string \| null, root_cause_text: string, work_order_number: string, confirmed_by: { user_id, name }, completed_at }` → `204` \| `202 { accepted: true, event_echo_id }`; VIDE uses it to improve fault models (brief 5.3) |
| analyze-style one-off prediction | EXTENDS A VERIFIED SHAPE | reuse `POST /diagnostics/analyze` VERIFIED shape; we call it mostly through webhooks/caches instead — the console's usage of forcing `force_ml:true` is for user-facing prediction; our flow keeps `use_llm:false` unless configured. Note the VERIFIED request has no org/auth fields; confirm tenancy story before real use. |

```ts
export interface CortexClient {
  getRulEstimate(machineName: string): Promise<RulEstimate | null>;
  sendConfirmedRootCause(input: ConfirmedRootCauseInput): Promise<void>; // retries; idempotent by event_id
}
```

---

## 4. Webhooks inbound (VIDE/Cortex → this app)

Endpoint: `POST /api/v1/webhooks/vide` (+ `…/marketplace`). Delivery contract:

- **Signature:** `X-Cogitex-Signature: sha256=HMAC_SHA256(raw_body, secret)` + `X-Cogitex-Timestamp`
  (unix seconds, reject skew > 5 min). Secret per webhook source from env.
- **Response:** `202 { received: event_id }` always after signature pass; processing is async
  (jobs queue) — fast-fail HTTP never reflects processing errors; monitoring handles those.
- **Dedup:** `UNIQUE(source, event_id)` — duplicates land in `webhook_in_events` as `skipped_duplicate`.
- **Persistence:** raw headers + body stored verbatim *before* parsing (brief §6).
- **Order:** events may arrive out of order; each carries `occurred_at`; consumers apply by that time.

Envelope (**PROPOSED** — confirm with VIDE team):

```jsonc
{
  "event_id": "uuid (producer-generated, unique)",
  "type": "fault.raised",                  // see table
  "source": "vide" | "cortex" | "marketplace",
  "schema_version": "1",
  "occurred_at": "ISO-8601 UTC",
  "data": { /* type-specific */ }
}
```

| type | data (essential fields) | App effect |
|---|---|---|
| `fault.raised` | `{ machine_name, device_id?, fault: { type, severity: 'info'\|'warning'\|'high'\|'critical', confidence? }, evidence?: { rule?, ml_prediction?, fused? }, sensor_summary? }` | upsert `fault_events` (dedupe by event_id), refresh vide_cache health, home attention queue + notification; optional auto-suggest WO (draft, agent-assisted) |
| `fault.cleared` | `{ machine_name, raised_event_id, cleared_at, reason? }` | close event, recompute machine health cache |
| `device.offline` | `{ device_id, machine_name?, last_seen_at }` | device status cache + notification (linkage health) |
| `device.online` | `{ device_id, machine_name?, at }` | as above |
| `repair_request.*` (`matched`, `quoted`, `accepted`, `declined`, `en_route`, `on_site`, `completed`, `failed`) | `{ request_id (ours), marketplace_request_id, technician?, quote?, eta_at?, reason?, outcome? }` | `repair_request_events` rows, status machine advance, notifications |
| `health.snapshot` (optional weekly push, alternative to polling) | `{ machine_name, score, samples[], as_of }` | vide_cache update |

Mock payloads for tests ship in `mocks/fixtures/` (pump-vibration-rise, motor-voltage-sag).

---

## 5. Write-outs (this app → VIDE/Cortex)

| Action | Proposed endpoint on VIDE | Body | When triggered |
|---|---|---|---|
| Decommission notice (stop ingestion, release device) | `POST /integration/machines/{machine_name}/lifecycle` | `{ action: "decommission", effective_at, reason, requested_by: { user_id, name }, org_ref }` → `202 { ingestion_released_from, device_release_at }` or `200` | end of decommission wizard |
| Reactivation notice | same endpoint | `{ action: "reactivate", requested_by }` → `200` | wizard reactivation step |
| Confirmed root cause | `POST /integration/faults/{event_id}/confirmed-root-cause` | §3 table | WO verified/closed path (once; idempotent retries) |

NOTE: these are PROPOSED touches on VIDE; we ship the calls behind typed clients with graceful
recording on failure (`vide_sync`/`machine_lifecycle_log` rows keep `vide_call_status`).

---

## 6. MarketplaceClient — Verified Technician marketplace

Subscriptions, **no per-job commission, no pay-for-ranking, no ads anywhere** (brief 5.4 + 8).
We are a client; matching/dispatch/verification live in the marketplace service (PROPOSED API).

```ts
export interface MarketplaceClient {
  createRepairRequest(input: RepairRequestDraft): Promise<{ marketplace_request_id: string; sent_at: string }>;
  // input: { local_request_id, org_ref, brief: { machine_snapshot, fault: { type, severity, confidence },
  //        health_trend, suggested_parts: [{sku, qty}], tools: string[], skill: SkillLevel, urgency }, }
  cancelRepairRequest(requestId: string, reason: string, byUserId: string): Promise<void>;
  getRequestStatus(requestId: string): Promise<MarketplaceRequestStatus>;  // reconciliation fallback
  listTechnicians(params: { skills?: string[] }): Promise<TechnicianProfile[]>; // cached on our side
  submitRating(input: { marketplace_request_id: string; rating: 1|2|3|4|5; note?: string }): Promise<void>;
}
```

Status mapping (marketplace → our `repair_requests.status`):
`sent → matched → quoted → accepted → en_route → on_site → completed → confirmed` — terminal:
`declined`, `withdrawn`, `failed`. Everything but `sent/withdrawn/confirmed` arrives via webhooks
(§4); `confirmed` + rating happen in our UI.

Subscription surface (billing lives in VIDE/marketplace; not in this app's DB): guarantee limit,
covered job credits, and usage counters must come from `GET /subscription/status` (PROPOSED) so the
"Request technician" button can show plan state, not per-job fees.

---

## 7. NotificationClient

In-app is implemented by this app. Email is ours (SMTP configured) initially; **push/WhatsApp/SMS go
through VIDE's shared delivery service once it exists** — interface-first:

```ts
export interface NotificationClient {
  send(input: {
    org_id: string; user_id: string;
    channel: 'in_app' | 'email' | 'push' | 'whatsapp' | 'sms';
    kind: string;                       // e.g. 'repair_request.update'
    title: string; body: string; data?: Record<string, unknown>;
    dedupe_key?: string;                // prevents duplicate pings for one underlying event
  }): Promise<'queued' | 'sent' | 'skipped'>;
  health(): Promise<{ provider: string; ok: boolean }>; // used on settings page
}
```

Rules: every send also writes `notifications` row (in-app always, audit of others); dedupe by
`(user_id, kind, dedupe_key)`; providers may return 'queued'; replaced with no UI change later.

## 8. IdentityClient

VIDE main has no auth today (the console is a single-user local tool). So:

- **Now (M0):** built-in Auth.js session (email+password/hash and magic link). `IdentityClient`
  wraps real session verification so app code never touches it directly.
- **Later:** adapter with the same interface backed by shared SSO (claims: user id, org id,
  orgs[], role, active org). No changes above the adapter.

```ts
export interface IdentityClient {
  authenticate(request: {
    strategy: 'password' | 'magic_link' | 'shared_sso';
  }): Promise<SessionContext>; // { user: {id, name, email, phone?, auth_provider_id?},
                               // organization: {id, slug, name, currency, timezone},
                               // memberships: { org_id, role }[] }
  listUsers(org_id: string): Promise<OrgMember[]>;    // assignment dropdowns
  registerExternalActor(input: { marketplace_technician_id: string }): // external tech scoping
    Promise<ExternalActorBind>;
}
```

Security invariant (CI-tested): any request where the resolved org ≠ requested org for data access
is rejected and logged.

---

## 9. OpenAPI + mock server

- Spec locations: `mocks/openapi/vide.yaml`, `cortex.yaml`, `marketplace.yaml`,
  `notifications.yaml`, `identity.yaml`, `webhooks.yaml` (generated from zod schemas via
  zod-to-openapi, refreshed in CI with `drizzle`-style drift check).
- Mock server: `mocks/server.mts` (node + hono/express, localhost:9001) implementing every
  PROPOSED + VERIFIED endpoint statefully with scenario fixtures:
  - `pump-vibration-rise.json` — vibration trend climbing, confidence 0.82 → 0.94 across days,
    `fault.raised`, RUL 72h→8h, urgency watch→critical.
  - `motor-voltage-sag.json` — `power_quality` event pattern (voltage sag), health watch.
  - `baseline-lean.json` — healthy machines, no open faults (empty-page demos).
  - marketplace simulation: scripted status progression + webhook delivery back to us.
- Contract tests run the same zod schemas against both spec + fixtures (CI), so real-service
  integration later is a config change, not a rewrite.
- Mock base URLs are recorded in `.env.example` as the default dev profile (`VIDE_API_BASE_URL=http://localhost:9001/vide/api` etc.) — **never** baked into app code.

## 10. Assumption register (every silent assumption turned into a question)

| # | Assumption | Status | Where it blocks |
|---|---|---|---|
| A1 | VIDE API base URL is configurable per deployment (console user-supplied) | informed (console input field) | nothing blocks design; prod URL needed before M4 real-switch |
| A2 | `/machines` filtered list is small enough to cache with 15s TTL | informed (12-machine demo) | list page perf tuning |
| A3 | Reading fields shown are all VIDE exposes (no richer telemetry) | VERIFIED for that page | energy deep-dives need the PROPOSED energy contract |
| A4 | Health score mapping 100/75/50/20 accepted by VIDE team as the canonical score bands | VERIFIED-in-console only | machine list badges + schedules |
| A5 | Marketplace status transitions arrive only by webhook (no polling mandate) | PROPOSED | M5 |
| A6 | No auth required on observed VIDE endpoints from a trusted network | VERIFIED-as-deployed | production security stance (add service token in the PROPOSED integration endpoints) |
| A7 | Confirmed root cause endpoint will exist (or VIDE volunteers a different one) | PROPOSED | M5 verification step |

Every table row above marked PROPOSED is cross-listed in `OPEN_QUESTIONS.md` so nothing is silently assumed.
