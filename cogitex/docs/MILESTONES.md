# Milestone Log

Each milestone ends with working software, passing tests, updated docs, and this log entry
(what changed / what is next), per the build brief §11.

## M0 — Scaffold, tokens, auth & tenancy, roles, integration interfaces, CI ✅

**Commit:** `M0: scaffold with VIDE design language, auth + tenancy/roles, integration interfaces with mocks, CI`

**Working software — what you can do right now**
- `npm run dev` → http://localhost:3000: VIDE-styled console (230px sidebar, eyebrow nav,
  accent active bar, 2px borders, sharp corners, scanline canvas, light/dark toggle persisted
  to localStorage — the pixel logo and every token are ported 1:1 from the VIDE main app).
- Sign up (you become Owner of your own org, created atomically with credential + audit rows)
  → land on the "Today" console with integration-status card and placeholder tiles.
- Sign in / sign out with scrypt-hashed credentials and signed session cookies (jose HS256, 30d).
- Middleware-gated routes; per-request Ctx reloads org + roles from the database (no stale claims).
- Settings page: org, session/roles, ability checks, integration health (mock profile by default).
- Placeholder pages for M1–M7 features (gated nav: Machines, Planning, Work Orders, Inventory,
  Repairs, Reports, Agent) so the demo reads coherently.

**Notable engineering decisions (documented deviations)**
- Package manager: **npm** (repo already used npm; pnpm absent on this machine).
- Auth: **built-in session auth** (`jose` JWT cookie + `user_auth_identities.password_hash`
  scrypt envelope) instead of Auth.js — behind the same `IdentityClient` seam for a future
  VIDE shared-SSO swap. VIDE has no SSO yet (OPEN_QUESTIONS Q3).
- Database dev/test: **PGlite in-process Postgres** (same SQL as production) when
  `DATABASE_URL` is unset in dev; tests migrate fresh PGlite instances. Production/Neon
  uses `postgres.js` with `prepare:false` (pgbouncer-safe).
- Deployment target confirmed: **Vercel + Neon Postgres** for the shareable demo
  (resolves OPEN_QUESTIONS Q12). README carries exact steps.

**Tests/CI:** 32 passing (tenancy isolation, signup service path incl. slug-collision
retry, ability matrix, password/session security, mock integration fixtures incl.
PUMP-3 rising-vibration + MOTOR-1 voltage-sag + kobo/Lagos formatting). CI: npm ci →
drizzle drift check → typecheck → tests → build (`.github/workflows/ci.yml`).

**What's next — M1:** machine registry (tables land), guided add flow, profile shell with
tabs, lifecycle wizards (add/edit/move/decommission/remove incl. VIDE lifecycle notice),
CSV import with dry-run, rich demo seed (12 machines).

## M1 — Machine registry: lifecycle, guided flows, CSV import, documents ✅

**Commit:** `M1: machine registry — lifecycle state machine, guided add/edit, decommission wizard, CSV import with dry-run, documents, 12-machine seed`

**Working software — what you can do right now**
- **Guided add flow** (`/machines/new`): identity (tag/name/category/make/model/serial/criticality),
  location (site + area, with link to `/settings/locations`), rated plate (stored in a
  `rated_specs` JSON payload used later by repair briefs + reports), and VIDE device links
  (checkboxes fed live from the integration adapter — mock defaults to PUMP-1…COMP-1).
- **Registry list** (`/machines`) with search (name/tag/serial), status / criticality / site
  filters; tag is unique per org (case-insensitive, enforced in DB and service).
- **Machine profile** (`/machines/[id]`) with 8 tabs: Overview (identity table, VIDE links,
  lifecycle action buttons), Health (VIDE `getMachineHealthSummary` + SVG sparkline, honest
  "mock/PROPOSED" labelling), Energy (7-day kWh bars + power-quality events), Maintenance
  (M2 placeholder + runtime counters), Parts/BOM (components, M3 will attach compatible
  inventory items), Documents (upload ≤5 MB to DB-backed storage, download route, soft delete),
  Faults (VIDE fault history; persisted events arrive in M4), Timeline (lifecycle log +
  audit merge with VIDE call acknowledgement column).
- **Lifecycle state machine** per DATA_MODEL §4.1: commissioned→active→standby↔active→
  under_maintenance→active, decommission from commissioned/active/standby/under_maintenance,
  reactivate (decommissioned→active). Decommission is a **wizard** (reason required, effective
  timestamp, open-WO policy note, parts-disposition note) that calls the VIDE
  `postLifecycleNotice` endpoint and stamps the acknowledgement (`acknowledged` / `failed`)
  on the timeline entry; reactivate sends the reverse notice and clears the decommission record.
- **Remove rules** (brief §5.6): soft remove archives (audit keeps it); hard delete is
  owner/admin-only and refused whenever any history row exists.
- **CSV import** (brief §5.1): paste CSV → parse (RFC-4180 subset, order-free columns) →
  inline-style validation per row → staged dry-run preview in the DB (`import_staging`,
  valid/error counts) → confirm → per-row execution with tag-conflict skips reported with
  row numbers. Staging is single-use; nothing is written until confirm.
- **Sites & areas** management under Settings → Locations (org-scoped, audited).
- **Demo seed** (`npm run seed`): 4 users (owner/manager/tech/viewer) + 2 sites, 5 areas and
  **12 machines** across the plant (pumps, motors, generator, compressors, conveyor, chiller,
  boiler) with rated specs, runtime hours, lifecycle statuses, BOM components and VIDE links.

**Schema landed (migration `0001`):** `sites`, `areas`, `machines` (+lifecycle enum, unique
org+tag, org-scoped indexes, decommission JSON, `profile_snapshot`), `machine_devices`
(tag→VIDE mapping the app owns), `machine_components`, `machine_lifecycle_log`
(append-only, with `vide_call_status`), `documents` + `document_blobs` (bytea — DB-backed
storage adapter for the demo; swap to S3 later without UI changes), `import_staging`.

**Documented deviations / notes**
- Document storage is the **DB bytea adapter** for the demo (works on read-only-filesystem
  Vercel); the documents table already carries the future S3 pointer columns shape (checksum,
  scan status) — scan hook is a pluggable no-op that quarantines dangerous extensions.
- Health/Energy tabs call the PROPOSED VIDE endpoints and **honestly label** the source;
  when the real profile raises (endpoints not shipped by VIDE), the tab shows the adapter's
  error instead of inventing data. Cache table + stale-while-revalidate lands with M4.
- Charts are server-rendered SVG/CSS bars (zero client JS for the registry); interactive
  charts can return at M6 if needed.
- Test hook: `__setDbForTests`/`__resetDbForTests` in the DB client lets the whole service
  suite run against fresh PGlite instances (production path untouched).

**Tests:** 53 passing (from 32). New: machines lifecycle machine (legal/illegal transitions,
decommission+VIDE ack+slog, reactivate clears record), tenancy on machines/documents/apps
(cross-org isolation), removal rules (soft/hard/history guard/role guard), CSV import
(missing column, bad categories, unknown site codes, duplicate tag skips, single-use staging),
CSV parser (quoted fields, CRLF, blank lines, order-free header). HTTP smoke verified live:
signup → site create → CSV import dry-run → commit (2 created/1 skipped) → machine list →
lifecycle transitions → decommission (VIDE ack in timeline); all profile tabs render 200.

**What's next — M2:** maintenance templates + schedules (calendar/runtime/condition) that
auto-generate work orders, full work order lifecycle (checklist steps, labor, status
permissions), Planning board (calendar + backlog + kanban-lite), `org_counters` WO numbering.

---

## M2 — Planning & Work Orders ✅

**Commit:** `M2: work orders + planning — lifecycle state machine, templates, PM schedules (calendar/runtime/condition), cron, calendar board`

**Working software — what you can do right now**
- **Work orders, full lifecycle:** create (corrective/preventive/inspection/installation,
  low→critical priority), `WO-XXXXXX` human numbering from row-locked `org_counters`
  (unique per org). Legal-transition state machine: `planned → assigned → in_progress →
  completed → verified → closed`, plus `on_hold` and `cancelled (reason required)`.
  Ability gates per edge (technicians execute + log own hours, planners plan/close,
  verify requires `wo.plan`); verification by someone **other than the assignee**.
  Completion is blocked while checklist steps are undone; a formatted completion summary,
  root cause, and downtime hours land on the card.
- **Checklists:** maintenance templates carry ordered, org-scoped steps (check / value /
  photo kinds, "requires value") that are copied onto every new card. Steps complete only
  while `in_progress`, values enforced where demanded, reopen supported.
- **Labor log, integer-kobo rollup:** minutes logged per user (techs log only themselves),
  cost = `Σ(minutes × kobo-per-hour) / 60` — no floats crossing a kobo boundary.
- **Machine follows the job:** jobs on an `active` machine drag it to `under_maintenance`
  when started and release it back on conclusions — best-effort, never blocks the WO.
- **Planning board (`/planning`):** Monday-first month calendar of cards (prev/next/today),
  open-backlog chips, PM dry-run preview + real run with role gate, PM generation log,
  schedule table with pause/resume, and a create form for calendar / runtime /
  condition schedules (threshold op `>`/`<`). Cards link into the WO lifecycle.
- **PM generation:** calendar (+N days with `next_due_at` advance), runtime (+N metered
  hours re-baselined on `machines.runtime_hours`), condition (metric cross via the VIDE
  adapter seam — mock serves the rising-vibration on PUMP-3). Open-WO dedupe per schedule
  (`schedule_runs` audit: generated/skipped/failed + basis + created WO). Re-arm on
  conclusion or schedule edit. `/api/cron/pm` runs it for every org daily under
  `CRON_SECRET` (middleware exempts machine-to-machine paths; browser sessions never
  reach cron).

**Notable decisions (documented deviations)**
- Manual WOs default to `planned`, not `draft` — `draft` is reserved for agent-proposed
  cards in M7, so "living" drafts are never user-visible.
- Work order steps are template-copied; case-specific ad-hoc steps come free in M3+ via
  the same table. Parts lines are free text right now — the ledger links them to
  inventory items in M3.
- Action routes sanitize empty-string uuid fields (`""` → null) and treat any malformed
  id as `not_found`; assignment validates org membership instead of a raw FK error.

**Tests/verification:** 64 passing (from 53). New: numbering monotonic `WO-000001|,
WO-000002`, auto-incrementÓ; illegal-jump + ability-gate rejections; cancel-reason;
steps-incomplete gating; verify-separation; machine drag/release; kobo rollup (120min ₦2,500/hr
= ₦5,000); template-step copy; PM calendar generate→advance→dedupe-skip; runtime
re-baseline; condition trigger counts via the mock adapter; cross-org schedule isolation.
`/api/cron/pm` verified: JSON `{created}` per org, PM-generated WO landed in backlog.
HTTP smoke verified live: signup → schedule create → WO create → assigned → in_progress
→ labor → completed; planning calendar + backlog render the card; cron 200 JSON.

**What's next — M3:** inventory (items, suppliers, append-only stock ledger,
reservations with availability), parts issued to work orders costing the card, low-stock
flags, backordered-parts flow on PO/cost, WO parts rollup completes cost view.
---

## M3 — Inventory, Stock Ledger & Reservations ✅

**Commit:** `M3: inventory — items, suppliers, append-only stock ledger, reservations, parts issued to work orders`

**Working software — what you can do right now**
- **Stock items** (`/inventory`): SKU (unique per org) + name + category/unit, opening stock
  booked as a `receipt` ledger row so every unit on hand is explained; fields for reorder
  point, unit cost (₦ naira → integer kobo), store location and supplier. Search box +
  "LOW STOCK ONLY" filter with ⚠ flags. Machine-compatible spares (✦) surface first in
  work-order pickers via `machine_parts` links.
- **Append-only stock ledger**: receipt / issue / adjust / return rows with signed
  quantity, unit cost at movement time, running balance after, reference (GRN/PO) and
  optional work-order link. No mutation or deletion — corrections are new rows
  (cycle-count `adjust` demands a reason, stores the delta).
- **Receive / Issue / Adjust / Reserve** on the item page; low-stock count computed by
  SQL (`qty_on_hand <= reorder_point`).
- **Reservations** are commitments, not movements: availability = on-hand − Σ open
  reservations; over-reserving is refused (`insufficient_available:N`). Issuing to the
  same card consumes open promises oldest-first. RELEASE cancels an open promise;
  concluding a work order (completed/closed/cancelled) auto-voids leftovers.
- **Parts on work orders**: WO detail now has ISSUE (stock moves now → ledger row +
  immutable part line with unit cost captured at issue time) and RESERVE (commitment),
  card header "PARTS / n LINE(S) — ₦x" and free-text lines still supported. Cost rollup
  = Σ(issued line qty × captured unit cost) — integer kobo, no floats.

**Notable decisions (documented deviations)**
- Reservations tracked in their own table rather than as `reserve/release` ledger rows —
  physical stock only moves with the ledger; promises are separate (cleaner audit trail).
- Suppliers stored app-side (name/email/phone/lead-time); the M5 Verified-Technician
  marketplace stays a separate integration seam.
- Item page issue/reserve forms pick from open work orders (draft/planned/assigned/
  in_progress/on_hold); the WO page picks from machine-compatible + all items.

**Tests/verification:** 75 passing (from 64; signup-path test timeout raised to 30s —
scrypt hiccups under parallel load). New: item CRUD + role gates (manager-only),
SKU uniqueness per org but not across orgs (tenancy), opening-stock receipt, receive
math + cost, issue over-stock rejection with exact balance in message, issue ledger +
card line + kobo rollup (2 × ₦1,000 = 200,000), adjust reason/no-change/delta,
availability math, over-reserve refusal, release, issue-fulfils-reservation,
WO-conclusion voids promises, cross-org invisibility. HTTP smoke verified live:
supplier create → item create (opening 10) → receive 5 → issue 3 to a WO (card cost
₦4,500) → adjust → low-stock filter isolates the zero-stock item.

**What's next — M4:** VIDE webhook receiver (shared-secret verified), fault events
resolved by device name (never trusting payload ids), cached health/energy reads,
fault → WO conversion.

## M4 — VIDE webhook receiver, fault events + triage, cached telemetry. ✅

**Commit:** `M4: VIDE webhook receiver, fault events with triage + WO conversion, cache-through health/energy`

**Working software — what you can do right now**
- **Webhook receiver** `POST /api/webhooks/vide` (machine-to-machine): shared-secret auth
  (`WEBHOOK_SECRET` env + `x-webhook-secret` header; 401 on mismatch, 503 in production
  when the secret is unset, open in dev so the mock profile works). Body carries an org
  slug claim + up to 100 events; the response reports per-event results so the sender can
  retry precisely. Kinds: `fault` (persisted) and `readings` (pre-warms the telemetry
  cache). Middleware exempts `/api/webhooks/` from the session-cookie redirect.
- **Fault events, resolved by device name**: machine references are looked up STRICTLY
  as `vide_machine_name` inside the claimed org — payload-supplied ids/uuids/urls are
  never trusted; unknown devices are skipped (`unknown_device:<name>`) and reported.
  Unknown severities fall back to `warning`, empty fault types to `unclassified`.
- **`/faults` console** (nav ungated): filters ALL/OPEN/ACKNOWLEDGED/CONVERTED/DISMISSED
  with an open-count lead line; rows show flag time (Africa/Lagos), severity chip,
  machine link (or "unlinked" device name), type/detail and state. Planner roles
  (`wo.plan`) get ACK / DISMISS / → WORK ORDER inline actions.
- **Machine page faults tab** now reads the DB (per-machine) instead of the placeholder
  adapter call; converted faults link straight to their work order.
- **Fault → WO conversion** (deterministic, no LLM): creates a corrective work order
  (severity critical→critical, warning→normal, watch→low, status planned), stamps the
  event `converted` + `wo_id`, audits `fault.converted_to_wo`, then redirects to the
  new card. Blocked for dismissed (`already_dismissed`) and converted events.
- **Cache-through telemetry**: machine health (10-min TTL) and weekly energy (30-min TTL)
  read via `vide_cache` — the VIDE adapter is only hit when the cache is stale, and a
  `readings` webhook pre-warms it. Cache rows are per-org keyed, so tenancy holds.

**Notable decisions (documented deviations)**
- Org claim in the webhook body is the org **slug** (stable, human-meaningful for an ops
  team configuring VIDE); the DB lookup is the only trust anchor.
- Fault triage requires `wo.plan` (planner roles), same gate as conversion — viewers are
  read-only; defense-in-depth re-checks state transitions in the service, not just UI.

**Tests/verification:** 90 passing (from 75; 15 new). Covered: device-name resolution
inside the claimed org, unknown-device skip, cross-org name isolation (same name in two
orgs is a different machine; payload ids never win), severity/type defaults, role gates
on all three triage verbs, ack stamps actor+time and rejects double-ack, dismiss from
open/acknowledged, conversion correctness (severity→priority, corrective type, planned
status, link + `woNumber` join) with `already_converted`/`already_dismissed` guards,
cache-through within/after TTL (fetch-count asserted) and per-org key scoping, and
route-level webhook tests (401 wrong secret, 200 correct secret, 404 unknown org,
400 malformed/empty, mixed batch round trip → triage → conversion). `tsc` clean,
`npm run build` green.

**What's next — M5:** repair marketplace (request → quotes with confirm-before-send,
adapter seam for VIDE Verified Technicians), then M6 reports (MTTR/MTBF-style metrics
and cost rollups computed in SQL — never LLM), M7 agent (deterministic intent matcher +
CONFIRM-gated write proposals), M8 PWA/security/seed polish.

## M5 — Repair marketplace: compile → human confirm → send → webhook lifecycle. ✅

**Commit:** `M5: repair marketplace — compiled brief, confirm-before-send, webhook lifecycle, confirm+rate`

**Working software — what you can do right now**
- **`/repairs` console** (nav ungated): REQUEST A TECHNICIAN form (machine select + optional
  open-fault link), status filter chips (ALL/COMPILED/SENT/…/CONFIRMED), rows with machine
  link, driving fault, urgency chip, status chip, technician + rating, quote in naira
  (kobo) or the manager's star result on confirmed rows.
- **Compile (never trusted straight to send):** builds a deterministic repair brief —
  machine snapshot (tag/name/category/criticality/linked VIDE device), linked fault
  (type/severity/flagged-at/description), 7-day health trend via the M4 cache, suggested
  spares (machine_parts ∩ inventory), skill+tools from a per-category knowledge table
  (pump→specialist+alignment kit…), urgency default (fault severity, else criticality
  A→high / B→medium / C→low). Row is created with status `compiled` — nothing left the org.
- **Confirm-before-send:** the request page shows the compiled brief with EDITABLE
  urgency + notes; SEND TO MARKETPLACE snapshots `confirmed_brief` (what actually went
  out), calls `MarketplaceClient.createRepairRequest` (mock adapter), records
  `marketplace_request_id` + `sent_at`, flips compiled→sent, appends a `user` event and
  audits. Compiled drafts can be discarded outright (nothing sent, so clean delete).
- **Status lifecycle** `sent → matched → quoted → accepted → en_route → on_site →
  completed → confirmed` (terminal: declined/withdrawn/failed) driven by
  `POST /api/webhooks/marketplace` (same WEBHOOK_SECRET scheme; tenant derived from the
  globally-unique marketplace request id — the payload carries no org claim to trust):
  quote (kobo)/ETA persisted, timestamped milestones, technician identity snapshotted into
  an org-scoped `technician_profiles` cache, append-only `repair_request_events` trail,
  idempotent replays, frozen terminal rows. `REFRESH STATUS` reconciles pull-based.
- **DEMO — SIMULATE THE MARKETPLACE WEBHOOK:** on the request page, next-valid-status
  buttons call the mock's `advance()` then apply the same status engine — hard-refused
  when the integration profile is not `mock` (in production only webhooks move rows).
- **Manager close-out:** WITHDRAW (pre-acceptance only, reason posted to the marketplace),
  CONFIRM + CLOSE on completed (star rating 1–5 + root-cause note) → `submitRating` +
  confirmation event; confirmed outcome is pushed back to VIDE via
  `CortexClient.sendConfirmedRootCause` (best-effort — contract is PROPOSED).
- **Cross-links:** fault rows get "→ REPAIR REQUEST" (compile with fault prelinked);
  open work orders get an EXTERNAL HAND card ("REQUEST TECHNICIAN →" compiles from the card).

**Notable decisions (documented deviations)**
- The marketplace owns technician identity; the app caches a per-org snapshot in
  `technician_profiles` from status payloads (rating/name kept fresh at each transition).
- URGENCY scale is the marketplace's (low/medium/high/critical) — machine criticality
  A/B/C maps deterministically (A→high, B→medium, C→low) and the human can override at
  confirm time; the sent values are what is snapshotted, not the defaults.
- Subscriptions model: all-inclusive — no per-job commission, pay-for-ranking or ads
  anywhere in the flow (same trust posture as the marketplace contract).

**Tests/verification:** 107 passing (from 90; 17 new). Covered: deterministic compile
(snapshot/fault/skill/parts/urgency incl. fault-driven critical), role gates + cross-org
compile refusal, compiled→sent with confirmed-brief snapshot and double-send refusal,
event trail, webhook transitions with quote/ETA/technician, idempotent replays, frozen
terminal rows, refresh reconciliation, tenant isolation of listings and status updates,
withdraw rules (sent-only; blocked after acceptance), confirm+rate (blocked before
completion), and the full mock walk sent→completed with quote consistency (₦45,000 =
4,500,000 kobo), plus route tests (401 wrong secret, 400 unknown status/malformed,
404 unknown id, happy path end-to-end). `tsc` clean, `npm run build` green.

**What's next — M6:** reports — uptime/MTTR/MTBF-style metrics and cost rollups computed
in SQL/pure functions (calc_version guardrails, never LLM), server-side CSV export,
PDF via pdf-lib or a print-view, reports listing + detail pages.

## M6 — Reports: deterministic metrics, calc bundles, CSV + PDF exports. ✅

**Commit:** `M6: reports — versioned deterministic calc bundles, MTTR/MTBF/uptime/cost rollups, server-side CSV + pdf-lib PDF`

**Working software — what you can do right now**
- **`/reports` console** (nav ungated): GENERATE form (PLANT SUMMARY for the whole org or
  MACHINE STATUS for one machine; period chips 7/30/90 days) + a GENERATED table (time,
  kind, scope, period length, calc version).
- **Report detail** (`/reports/[id]`): headline tiles (completed WOs, faults flagged,
  maintenance cost, period length), metric chips (MTTR / MTBF / UPTIME / PLANNED RATIO /
  BACKLOG with priority split), a server-rendered CSS bar chart of cost by month, the
  top-12 cost-by-machine table (rows link to machines), labor/parts/type-mix footer, and
  a PROVENANCE note stating the bundle's version and rule lineage.
- **EXPORT CSV** (session-gated API route, `text/csv` attachment): sections for metrics,
  faults by severity, cost by machine, cost by month and the WO type mix — deterministic,
  byte-identical for the same calc.
- **DOWNLOAD PDF** (session-gated API route): the same bundle rendered by `pdf-lib` onto
  A4 — brand-red headers, key/value metric rows, top tables, provenance line; served as
  an attachment (`cogitex-<kind>-<date>.pdf`).
- **Metrics engine** (`src/server/metrics/reports.ts`, `CALC_VERSION 1`): pure functions
  over org-scoped rows only. Period membership = created-in-window OR completed-in-window;
  MTTR = mean labor minutes of completed breakdown (corrective) cards; MTBF = calendar
  hours of the scoped machine set ÷ breakdown completions; uptime = 100 − Σ recorded
  downtime hours ÷ period calendar; planned_ratio = planned-family completions ÷ all
  completions; cost = labor (minutes × captured rate, rounded per hour) + parts (qty ×
  captured issue-time unit cost) with by-machine / by-type / by-month splits; faults
  sliced to the period with severity counts; open backlog by priority. Unknowns render
  as "no data" — never fake zeros. Money is integer kobo throughout; stored calc keeps
  full values, rounding happens at render time only.
- **Narrative guard ready for M7** (`validateNarrative`): any narrative text over a calc
  bundle is post-checked so every numeral in the text must exist somewhere in `calc` —
  a model can describe the numbers, never invent them.

**Notable decisions (documented deviations)**
- MTBF uses calendar hours of the scoped machine set (30d × 24h × machines) rather than
  a runtime-hours feed — VIDE runtime history is a PROPOSED contract; the formula is
  isolated in one place so the input can swap without touching consumers.
- Downtime is the human-recorded `downtime_hours` on completed cards, one more input the
  M8 seed enriches; uptime is therefore honest-but-minimal until real records accumulate.
- New `report.view` ability: owner/admin/maintenance_manager/technician/viewer; external
  technicians excluded. Generating is reading-plus, but stays behind the same gate.
- PDF text is sanitized to WinAnsi (₦ → "NGN ", arrows → "->"); standard PDF fonts cannot
  encode the naira glyph — keeping pdf-lib dependency-free of embedded font files.

**Tests/verification:** 120 passing (from 107; 13 new). Covered: period membership
(created-vs-completed, out-of-window rows excluded), MTTR from known labor minutes,
MTBF arithmetic, one-decimal uptime/planned-ratio, cost rollups (labor+parts, out-of-period
parts row ignored, by-machine attribution sorted), fault slicing + severity counts +
machine scoping dropping non-attributable rows, narrative guard (pass/fail with offender),
per-WO cost helper, service generation against a seeded plant (numbers match the ops
rollup: 120 min × ₦2,500/h = ₦5,000.00 → 500,000 kobo), machine_status scoping +
machine_required, full tenancy isolation both directions, verbatim calc storage,
byte-identical CSV, and a PDF smoke (valid %PDF- header). `tsc` clean, build green.

**What's next — M7:** agent — deterministic local intent matcher (keyless) + optional LLM
gateway for intent/param extraction only, read tools scoped from Ctx, write proposals with
explicit CONFIRM, `/agent` chat page, agent_tool_logs with citations (record ids).

## M7 — Maintenance agent: deterministic chat, org-scoped tools, CONFIRM-gated writes. ✅

**Commit:** `M7: agent — deterministic intent matcher + LLM intent-only seam, org-scoped read tools, CONFIRM-gated write proposals, agent_tool_logs`

**Working software — what you can do right now**
- **`/agent` chat console**: live conversation (quick-start chips included) where every
  answer comes from a TOOL RUN against org-scoped rows, citing clickable record chips
  (machine → machine page, WO → card, SKU → item page, fault → faults board). A RECENT
  TOOL ACTIVITY table shows the last calls with status + citations.
- **Read tools** (any member; `cost_summary` gated on `report.view`): machine brief
  (tag/name lookup + open faults + open cards + last cards), open faults (severity
  filter), open work orders, stock lookup (on-hand vs reserved availability + reorder
  flag), cost summary — which runs the SAME `computeMetrics` engine as Reports and
  refuses any numeral that cannot be traced to the calc bundle (`validateNarrative`),
  falling back to a pointer at /reports. Phrasings: "what's wrong with PUMP-3?", "any
  critical alarms?", "open work orders", "stock for BRG-6204?", "cost last 90 days".
- **Write tools are PROPOSALS first**: the matcher returns a plan, the service stores it
  as a `write-proposed` row, and NOTHING executes until the user presses CONFIRM in the
  chat (or DISCARD it). Confirmed runs re-derive roles server-side. Tools: create work
  order (source=agent, planned), acknowledge fault, convert fault→WO, compile repair
  request (draft ONLY — the human still sends it; refusal text says so).
- **Keyless by design**: with no model key configured the intent matcher is fully
  deterministic (regex + machine-name resolution against the org's machines). If
  `AGENT_LLM_API_KEY` is set, an LLM maps text→(tool,args) ONLY — rigid JSON out,
  zod-ish validation against the tool registry, 12s timeout, any error falls back to the
  local matcher. The LLM never computes numbers, never sees org rows, and cannot name
  orgs or ids.
- **Every call logged**: `agent_tool_logs` (migration 0008) records status
  (read / write-proposed / write-executed / write-refused), tool, args, sanitized
  result, citations, `via` (local|llm) and errors; execute also writes an audit entry
  with actorKind "agent".

**Notable decisions (documented deviations)**
- Fault-addressing tools ("acknowledge/convert the latest fault on BLW-1") resolve the
  LATEST open fault of the named VIDE device free-text-first — fault Events are uuid-keyed,
  so the chat UX cites rows instead of asking users to type ids; explicit `faultId` args
  are still accepted.
- The proposal row is user+org+status scoped: a foreign confirm or replay gets
  `proposal_not_found` / `not_pending:*`; discarded proposals are marked write-refused
  with reason "discarded_by_user", never executed.
- Intent regexes treat "open work orders"/"backlog" as listing FIRST and require a
  creation verb (`create/plan/schedule/new/raise`) near a singular noun for writes, so
  prose can't accidentally arm a write.
- Cost chat verbalizes integer kobo (canonical money unit) rather than ₦-formatted
  values so every numeral remains substring-traceable inside the stored calc JSON.

**Tests/verification:** 134 passing (from 120; 14 new). Covered: canonical phrasings
routing, create-intent extraction (machine/type/priority, 80-char titles) + gibberish →
none, keyless determinism (via=local), machine brief content + citations, fault list with
severity, stock availability math (reserved vs available 10−4=6 pcs), cost summary with
the narrative guard passing against a seeded card, cross-org non-resolution ("No machine
matching" — chat tools never leak), the full propose→CONFIRM→WO(source=agent, planned)
flow with double-confirm refusal, discard-and-refused flow, acknowledge/convert device-
scoped flows (ack BLW-1 leaves PUMP-3 intact; convert then hits PUMP-3), compile-repair
drafts-only semantics, viewer refusal logged as write-refused with no execution, proposal
scoping (other org + other user both `proposal_not_found`), and the tool-activity log
with citations. `tsc` clean, `npm run build` green.

**What's next — M8:** PWA (manifest + offline shell + service worker with logo-mark
icons), security headers, enriched demo seed (fault events, inventory movements, WO
history) for mock-data testing, and the About/app-info page with the with-name lockup.

## M8 — PWA, security headers, enriched demo seed, About page. ✅ (final milestone)

**Commit:** `M8: PWA manifest + static-only service worker, security headers, enriched demo seed (VIDE fault history + work-order history), About page with the with-name lockup`

**Working software — what you can do right now**
- **Installable PWA**: `manifest.webmanifest` is served by the app-router manifest route
  (name/short-name "Cogitex", standalone, start at /today, dark `#0b0c10` theme), icons
  generated from the MARK logo (192/512 + maskable — the with-name lockup stays out of
  chrome/icons); the root layout now carries the png icon + apple-touch-icon.
- **Service worker** (`public/sw.js` + production-only registration): STATIC-ONLY by
  design — immutable assets (`/_next/static`, `/img`, precached logo marks) go
  cache-first; every page and API stays network-only because all pages are
  server-rendered and session-gated (caching them would leak one user's session to
  another). Cache version-out on activate.
- **Security headers** on every route: CSP (self + the inline allowances Next.js needs),
  nosniff, frame-ancestors none, strict referrer, permissions lock-down, HSTS.
- **Enriched demo seed** (`npm run seed` against a real DATABASE_URL): the demo plant now
  carries VIDE fault history (6 events: open critical/warning/watch, an acknowledged, a
  converted that links to COMP-1's done card, and a dismissed gateway dropout), plus two
  older work orders (a 50-day-old corrective coupling swap with 2 h recorded downtime and
  a 35-day-old preventive exercise run) so Reports has honest MTTR/MTBF/uptime/cost data
  on first open — alongside the existing machines, sites/areas, templates, schedules, a
  live/in-progress card with issued-parts + open reservation, and stock movements.
- **About page** (`/about`, new SYSTEM nav item): the one place using the with-name
  lockup, plus what-shipped (M0→M8), how data flows (what this app owns vs. what VIDE
  owns), the integration profile, money/time conventions, and a calc-version line. No
  invented contact details — escalation routes via the org's onboarding channel.

**Notable decisions (documented deviations)**
- The service worker deliberately does NOT cache HTML or API responses. An "offline
  shell" for this app means fast repeats of static assets; anything auth-bearing is
  network-only so offline determinism can never show another tenant's data.
- CSP keeps `unsafe-inline` for scripts/styles because Next.js App Router inlines
  flight/bootstrap data and the theme boot script; everything else is locked to self.
- Seeded faults mirror the webhook intake rules exactly (device must be linked; payload
  kept verbatim) and statuses cover the whole triage surface, giving mock-data testing a
  populated faults board, agent answers and repair briefs immediately after seeding.

**Tests/verification:** 134 passing (M8 adds configuration + seed data rather than new
pure logic). `tsc` clean, `npm run build` green — routes confirm `/about`, `/agent` and
`/manifest.webmanifest` in the manifest. The build was run with the dev server stopped
(as always, so `.next` is not clobbered).

**Handover — where testing with mock data starts**
1. `npm run dev` (fresh PGlite applies migrations 0001–0008 automatically).
2. Sign up a fresh account — the first member of a workspace becomes ADMIN/owner.
3. Prefer a REAL database? Run `DATABASE_URL=… npm run seed` for the Anyanwu demo plant
   (4 users incl. owner/manager/tech/viewer at demo1234) and sign in with those.
4. Walk the flows: machines → planning → work orders; drive faults via the mock VIDE
   webhook; compile → SEND a repair request (demo-advance it); generate 90-day reports
   and download PDF/CSV; chat with the agent and CONFIRM a write proposal.

### M8 addendum — logo fix

**Commit:** `fix: logos — replace broken Affinity SVGs with trimmed transparent PNGs`

The client-supplied `logo-mark.svg` / `logo-full.svg` (Affinity exports) embedded their
raster at ~1190 px inside a 5225×5225 canvas, so every `<img>` referencing them (sidebar,
login, signup, the tab favicon clone) rendered the mark at ~23% size with huge empty
padding. Fix: `Logo.tsx` now references the trimmed transparent PNGs (mark 1254×969,
lockup 1204×998); the PWA icons and the new `src/app/icon.png` favicon are regenerated
with aspect-fit letterboxing (never stretched); the two broken SVGs and `src/app/icon.svg`
are removed. 134 tests passing, `tsc` clean, build green.

## M9 — Suite deploy test (started)

**Scope note:** the product is now the **VIDE SUITE** = VIDE CORTEX (prediction/ML console,
lives separately) + Cogitex Maintenance, deployed to Vercel as two apps on one design
language. The suite master plan lives at `OneDrive/Belgeler/vide suite/SUITE.md`.

**Done in this step**
- **Cross-suite links, env-configured both ways:** VIDE CORTEX's footer button
  ("OPEN COGITEX MAINTENANCE ↗") reads `NEXT_PUBLIC_SUITE_COAPP_URL`; Cogitex's sidebar
  footer shows the inverse "OPEN VIDE CORTEX ↗" only when its
  `NEXT_PUBLIC_SUITE_COAPP_URL` is set — selling Cogitex standalone = omit the var,
  the link disappears (suite wiring must never be hard-coded into the standalone build).
- Local env wiring (gitignored `.env.local`, mirrored to Vercel project env vars at
  deploy time): both apps' LLM seam points at OpenRouter (`AGENT_LLM_*` on Cogitex,
  `OPENROUTER_*` on VIDE); Vercel deploy matrix + roadmap (M9–M13: deploy test,
  SIM engine with 30 simulated machines, chatbot everywhere, machine media binders,
  professional design pass) are documented in SUITE.md.
- **Fix (root cause, day-one):** the auth middleware redirected **every static asset**
  (`/img/*`, `/icon.png`, `/manifest.webmanifest`, `/sw.js`) to `/login` for logged-out
  visitors — so the login page's `<img>` was being handed login HTML instead of the
  logo PNG. This is what "the logo doesn't display on login" has been since M1: a
  middleware matcher bug, not assets or caching. Matcher now excludes
  `_next/static|_next/image|img/|icon.png|favicon.ico|manifest.webmanifest|sw.js`.
  Verified anonymously: `/img/brand-mark.png` → 200 `image/png` (286 KB),
  `/sw.js` → `application/javascript`.
- VIDE CORTEX validated for deploy: `npm install` + `tsc --noEmit` clean.
- Full suite: 134 tests passing, `tsc` clean, build green (dev stopped).

### M13 step 0 — design system V2 (foundation)

**Commit:** `M13.0: design system V2 — paper/charcoal/orange tokens, hairline surfaces, motion, mobile-first shell`

The whole-app foundation, applied before page-by-page sweeps (so M10–M12 features are
built ON the new system). Same class vocabulary as V1 → every page retints with no JSX
changes:

- **Tokens**: paper canvas `#faf9f7` + white cards, charcoal sidebar `#1d1b18`
  (with deep chrome brand block), hairline `#e8e5df`, Cogitex orange `#f5871f` with
  wash/depth variants, status dot-chips (ok/warn/high/crit/info) each with soft tints,
  elevation tokens (shadow-1/shadow-2) and focus-ring token.
- **Type**: Inter everywhere + JetBrains Mono via `next/font/google` (self-hosted,
  no runtime dependency); `.mono`/`.tag`/`.tnum` utilities for tags, ids and numerals;
  heading scale (h1 20px/−0.3), eyebrows uppercase 10px/1.8 tracking.
- **Surfaces**: all 2px boxes → 1px hairlines + 12px radius cards with soft shadows;
  tile hover lift; scanline/pixelated decorations removed; dashed separators → solid
  faint rules; tables/`kv` numerals tabular.
- **Controls**: gradient primary button with inner sheen, secondary ghost, new
  `primary-ghost` variant; inputs get orange focus ring; `:focus-visible` ring
  token everywhere; reduced-motion respected.
- **Mobile-first**: off-canvas charcoal rail with glide + scrim blur, 44px NAV toggle
  touch target above safe-area insets, sticky blurred topbar, safe-area paddings in
  sidebars/footers/toasts, 15px inputs (iOS zoom-safe), tightened mobile paddings.
- **Dark variant retained** (`[data-theme="dark"]`): warm charcoal surfaces with the
  same accent/status system; boot script honours stored choices, light is default
  (stored-only dark from V1 tests keeps working coherently).
- VIDE CORTEX's terminal styling stays there for now; its V2 pass lands in this suite
  sweep with the same tokens (charcoal rail + paper + orange).

`tsc` clean, `npm run build` green (fonts fetched at build, verified).

### M13.1 — cache-defeated brand assets + Notion rail + DM Sans

User-visible follow-ups from testing the V2 foundation:
- **Logo cache fix (the durable one)**: the M8 service worker had cached broken-era
  bytes cache-first at the historical `/img/logo-*.png` URLs. The brand files now live
  at **fresh URLs** (`/img/brand-mark.png`, `/img/brand-lockup.png` — same original
  trimmed bytes, new cache-proof names), referenced by `Logo.tsx`, the About page,
  layout favicon/apple icons; SW cache bumped to `cogitex-static-v2` (activate wipes
  v1) and precaches the new URLs. Verified in the served HTML + asset 200s.
- **Rail restyle (client note: "black bar looks generic — sleeker, Notion/Obsidian")**:
  the charcoal sidebar becomes a warm tonal light rail (default), rounded nav rows with
  white hover cards + soft shadows, orange-tinted active pill (no edge marker bar),
  compact brand block. Charcoal persists as the dark-theme rail.
- **Type swap (client-selected)**: DM Sans replaces Inter as the UI face
  (`next/font/google`, self-hosted); JetBrains Mono keeps tags/ids/numerals.

`tsc` clean, build green; dev relaunched on 3030.


---

## Cogitex M13.3 �" calendar actions + authenticity fixes (commits 076b5f6, f3b8cd8)

**What changed**
- Planning calendar: day panel restructured �" DAY VIEW card sits ABOVE the month grid; per-card EDIT (new `/work-orders/[id]/edit` page + `updateWorkOrderAction`, returns to the day view) and REMOVE (transition �' cancelled with recorded reason via `back` redirect) plus a `+ ADD CARD` primary button; every day cell gained a persistent `.daymore` button (+N more). Calendar/panel exclude cancelled cards.
- Hydration heal: `RegisterSw` in dev now unregisters any legacy service worker + clears all caches (the reason interactivity died �" no chat POST, native GET form submits); sw.js bump to `cogitex-static-v3`; dev PGlite now persists to `./.pglite` (accounts survive restarts).

## Cogitex M13.4 �" theme + auth chrome + robustness (commit f3b8cd8)

**What changed**
- Theme toggle rewritten to be hydration-independent: inline `__cogitexToggleTheme` + `data-action="theme-toggle"` click delegation in the root layout boot script; Topbar button carries data-action (no React onClick) �" dark/light flips even with zero JS.
- Auth pages: bottom logo/description strips removed (login + signup) �" clean single card on the grain texture.
- middleware: dev-only `Clear-Site-Data: "cache", "storage"` on /login + /signup �" origin purge that requires no JS (session cookie untouched).
- `/machines/[id]` uuid guard (notFound for garbage ids); WO RELATED machine link hidden when machineId null.

**Verified**
- tsc clean; build green; 134/134; Clear-Site-Data header observed live on /login.

**Next**
- VIDE V2 passes 2+ (per-page sweeps, PixelLogo decision), M10 SIM engine, M11 agent chatbot, M12 media binders, Vercel deploy once GitHub/Neon arrive.

---

## VIDE V2 pass 1 (commit 281daca baseline, 3f770e4 tokens)

**What changed**
- Repo initialised (`281daca`) �" mock fleet Next.js app builds green.
- Suite tokens: light paper `#faf9f7` default + warm-charcoal dark; cogitex-orange accent; DM Sans via next/font with JetBrains Mono reserved for numerals/tags; hairline borders + soft shadows; 160ms ease motion; rounded Card/Tile/Button; hairline Sidebar/Topbar; Token architecture preserved (Tailwind mappings unchanged).
- Retired the pixel-terminal rules (2px borders, radius 0, notch, mono-everywhere) per suite direction.

**Next**
- VIDE V2 passes 2+: per-page sweeps (/machines, /diagnostics, /predictions, tables), PixelLogo vs shared brand assets, DataTable polish.

---

## M10 � SIM fleet + VIDE?Cogitex live bridge (this session)

**The pipe is real now.** One deterministic generator (30 machines / 3 sites) is the
single source of truth for BOTH apps.

**VIDE side**
- src/lib/api/mock/fleet.ts: full 30-machine SIM fleet replaces the 4-machine
  mock � Ota Plant (healthy flagship), Agege Works (mixed), Ikorodu Yard (three
  machines in active breach: ikorodu-conveyor-02, ikorodu-fan-01, ikorodu-chiller-01).
  Signals are pure functions of time; criticals drift past TEMP_FAIL_C/VIB_CRIT_MM_S.
- New SIM API (also serves Cogitex's real adapter):
  - GET /api/health/detailed � VERIFIED endpoint
  - GET /api/machines � VERIFIED (camel+snake mirrors)
  - GET /api/readings/recent/{machine}?limit=N � VERIFIED
  - GET /api/diagnostics/critical-events?limit=N � VERIFIED
  - GET /api/machines/{machine}/health-summary?window=  � PROPOSED, now shipped
  - GET /api/machines/{machine}/energy-summary?from&to&bucket � PROPOSED, now shipped
- POST /api/sim: the SIM ? COGITEX button (Topbar) pushes the digest to Cogitex's
  ingest webhook: 30 machine upserts + live faults + telemetry snapshots.
  Env: COGITEX_INGEST_URL (default localhost:3030), COGITEX_INGEST_SECRET.

**Cogitex side**
- /api/webhooks/vide: new kind:"machine" event (machinesWriteService.upsertFromWebhook):
  find-or-create site ? find-by-name-or-create machine (tag unique per org, tag
  conflict links the pulse into the existing machine) ? ensure machine_devices link.
  Org "*" resolves to the single org (demo convention; multi-org needs the real slug).
- RealVideClient: the two PROPOSED endpoints now implemented over the SIM API
  (getMachineHealthSummary ? /machines/{n}/health-summary, getEnergySummary ?
  /machines/{n}/energy-summary). No more throw-on-PURPOSE in the real profile.
- .env.local: INTEGRATION_PROFILE=real + VIDE_API_BASE_URL=http://localhost:3000/api.

**Verified live**
- POST /api/sim ? 30 "created", 7 faults "inserted", 7 snapshots stored (44 events received).
- GET /api/sim ? healthMix 16/7/4/3 across 3 sites.
- Critical chiller health summary: score 11, RUL 24h, affecting temperature_c.

---

## VIDE V2 pass 2 (commit a0a8e43) � suite language sweep

- Retired pixel-terminal styling everywhere it survived: order-2 rows/cards/charts/
  charts/toasts/photos/chat panes and modal 
otch ? hairline order + suite
  rounding (
ounded-lg/xl), toast gains elevation.
- Pixel mascot deleted; SuiteLogo renders the shared Cogitex brand mark from
  public/img/brand-mark.png (asset copied from Cogitex repo).
- Stale demo data excised: old 4-machine maintenance history rebound to sim machines
  (ikorodu-conveyor-02, gege-conveyor-01); factory label reads
  "VIDE SIM Fleet � 30 machines / 3 sites (mock)".
- tsc clean.

---

## M11 - real agent answers, suite-wide SIM switch, live Today (this session)

**The suite chats for real and one switch controls the simulation everywhere.**

**Infra fix first (root cause found)**
- This machine's network path corrupts Node TLS 1.3 (OpenSSL SSL alert 20: bad record
  mac on every Node fetch to OpenRouter; curl.exe/Schannel passed). Fix: NODE_OPTIONS=--tls-max-v1.2
  set via setx (user env, durable) + written into both dev-server launcher .cmd files.
  Before this, EVERY LLM call from Node failed silently-into-fallback.

**VIDE side (commit dd395c9)**
- src/lib/sim/state.ts: persisted global SIM state (.sim-state.json, gitignored;
  write is best-effort so Vercel's read-only FS only loses persistence, not behavior).
- The **SIM ON/OFF toggle** (Topbar) flips the whole suite: POST /api/sim {action:"toggle"};
  every /api/* route gates on the flag - machines [], readings [], critical-events [],
  health/detailed {mode:"disabled"} etc. Cogitex's real adapter therefore sees the
  change with zero Cogitex-side code. Toggling ON re-pushes the fleet to Cogitex.
- /api/chat: the console's assistant bridge - OpenRouter with a live FLEET DATA block
  (worst machines + open anomalies, deterministic from the SIM engine). Honest 502 on
  failures; never a simulated reply. ChatPanel switched to it (mock echo removed).
- Console honors the switch client-side too (useSimState localStorage mirror +
  CustomEvent on all mounted pages): useMachines / OverviewView / DevicesView.

**Cogitex side (commit 6ddc26c)**
- agent.ts phrasing layer: tools still run deterministically org-scoped and produce a
  faithful draft; when the LLM is configured, phraseWithLlm restates the result
  naturally, echoing ONLY numbers/ids verbatim from the tool payload (cost_summary is
  excluded - its validateNarrative guarantee stays; data never leaves the server).
- Intent precedence FIXED: the local rulebook is now authoritative ("open faults" was
  being misrouted to list_open_work_orders by the intent LLM); the intent LLM only
  fills phrasings the rulebook misses. Rulebook hits also save the 12s intent call.
- /today rebuilt from M0 placeholders to live data: FLEET / OPEN FAULTS (with
  severity split) / DUE THIS WEEK / LOW STOCK tiles, an attention queue
  (faults -> due WOs -> low stock) and the VIDE heartbeat card incl. SIM ON/OFF.

**Verified live (curl, minted session)**
- Toggle OFF -> /api/machines = [], /api/health/detailed {status:"disabled"}; Cogitex
  /today flips to "VIDE LIVE . SIM OFF" instantly; toggle ON -> 30 machines back.
- VIDE /api/chat: gpt-4o-mini answer naming the live critical machines + temperatures.
- Cogitex agent: naturally-phrased answers with verbatim counts/citations, 200s.
- /today: HTTP 200, 70KB, real tiles (30 fleet / 20 open faults / 9 critical).
- Tests: 134/134; tsc green both repos.

**M11 suite SSO — one login opens the suite (VIDE e0bfb10, Cogitex 67e2023)**

User ask: "once logged in in VIDE it automatically logs into Cogitex."
- VIDE now has a real login (env users, HS256 session cookie, chromeless
  server-rendered /login, console pages regrouped under (console) so the login
  page has no cockpit chrome; middleware gates pages, /api stays open to the
  bridge).
- VIDE issues a 5-minute aud=cogitex-sso token (shared AUTH_SECRET) addressed
  to the planner's /api/auth/sso; hosts allow-listed. Cogitex middleware sends
  stranded visitors to VIDE_LOGIN_URL with the exchange URL; the exchange maps
  email -> planner user and starts a normal session. Zero page JS in the chain.
- Verified live with a cookie jar: fresh planner visit -> VIDE login (sso
  param) -> one POST -> 303 planner exchange -> session -> live /today; a
  signed-in VIDE /login?sso visit auto-hands-off with a fresh token. Tests
  135/135 (planner unchanged). Dev creds: mikedeimu@gmail.com / cortex-maple-77.

**M11 continued - real multi-turn chat (Cogitex fbc329a, VIDE 7743c07)**

The agent became a real chatbot: it now remembers the conversation.
- agentService.chat(ctx, message, history) threads the recent turns (cookie-held,
  last 6, stale proposals dropped) into the intent-LLM and the phrasing-LLM -
  follow-up context ONLY; tools still produce every number verbatim.
- matchIntentLocal gained a deterministic follow-up rule: machine-noun phrases
  ("what about the chiller?", "and the fan?") resolve against the org register
  with zero latency and no LLM call.
- Intent-LLM hardened: explicit nested-JSON examples (OpenRouter models was
  emitting flattened args like severity beside tool) and a salvage step that
  folds stray top-level keys back into args.
- VIDE mirror: /api/chat accepts a validated history array (max 6 turns x 500
  chars) and plays it to OpenRouter before the question; ChatPanel sends its
  rolling conversation and resets it on Clear chat.
- Verified live through the no-JS form protocol: "open faults" -> 20-fault
  answer (8 citations); "what about the chiller?" -> IKR-CHILLER-01 brief with
  citation. VIDE: "which machine is worst?" -> "and its exact temperature?"
  resolved via history to ikorodu-chiller-01 94.4C / 8.7 mm/s.
- Tests 134/134; tsc green both repos.

## Aesthetic sweep � suite-wide UI polish (2026-10-22)

Goal per user: "clean the whole suite up so we can push to vercel � slick,
future-proof, professional, and scales well on a phone."

- SIDEBAR ICONS (both apps): every nav tab carries a consistent inline SVG
  icon (Cogitex: Today=cog, Machines=gear box, Planning=calendar, Work
  Orders=list, Faults=alert, Inventory=box, Repairs=check-circle, Reports=
  columns, Agent=sparkle, Settings=sliders, Locations=pin, About=info;
  VIDE: Overview=cog, Machines=gear, Devices=monitor, Diagnostics=check,
  Predictions=flash). Active tab keeps the accent tint; icons are inline
  SVG strings in the nav configs (dangerouslySetInnerHTML on a .nav-icon
  span) � no image assets to deploy.
- LOGIN PAGES - GLASSMORPHISM BOTH (vide d306d35, cogitex 6be5d5f): gradient
  mesh background (radial glows in --grad1/--grad2 + faint grid overlay),
  glass card (backdrop-blur 24px, translucent panel), gradient SIGN IN
  button with glow hover, outlined CREATE ACCOUNT button, "NEW TO THE
  SUITE?" / "OR CREATE A PLANT" dividers, crit-tinted alert chips with dot,
  brand-mark tile with glow shadow, watermark in the corner. Dark-mode
  gradient tokens added to cogitex dark theme (--grad1/--grad2).
- /today DASHBOARD: stat tiles now color-coded by live health state �
  FLEET red-tinted when critical faults exist, amber on warnings; DUE THIS
  WEEK / LOW STOCK amber when > 0 � using stateStyle record (ok/warn/crit
  border + value tints). Avatar chip with user initials (gradient tile +
  glow) beside the greeting. Cards/tiles?? glass (translucent panel +
  backdrop blur, 14px radius, shadow-2).
- VIDE FLEET OVERVIEW: Tile component gained glass variant (bg-panel/60 +
  backdrop-blur) and health states � FLEET ONLINE amber when any machine
  offline, FLEET HEALTH red<70/amber<90, OPEN ANOMALIES red when > 0.
  Tiles stack 1-col on phones (sm:grid-cols-2 lg:grid-cols-4).
- TOASTS: both apps render glass status pills (bg-panel/85-90% + blur).
- MOBILE (the user's Edge + any phone): >=16px inputs on <=480px (blocks
  iOS zoom-on-focus), 44px touch targets for buttons/inputs/nav links,
  stat tiles stack below 480px, topbar title truncates (46vw max), VIDE
  topbar controls wrap into neat rows and the status badge hides on <sm
  (duplicates the sidebar dot), Cogitex NAV toggle became a branded
  floating MENU pill (icon + label, aria-expanded synced, close state).
- All tsc green; dev verified live; SSO front-door chain re-proven after
  every pass (create-account -> VIDE session -> planner / -> /today 200
  FLEET). Commits: cogitex 88ae660/6be5d5f/05c2b61, vide 4273c38/d306d35/
  8b8d6ec/fea2ea7.

## UPGRADE SPRINT item 1 — Machine profile v2: maintenance history + expenditure log ✅

**Commit:** `machine profile v2 — MAINTENANCE tab live with WO history + per-machine expenditure log (migration 0009 machine_expenses)`

The agreed upgrade sprint (documentation v1.0 §10.5) starts here. One coherent
data model for "what has this machine ever cost us / been through":

- **MAINTENANCE tab is no longer a placeholder.** It is now the machine's
  story: MACHINE STORY header (last service + WO number, open/done count,
  12-month spend, lifetime spend with labor/parts/manual split), a full
  work-order history table (number → card, type, status with color, finished
  date, downtime, per-card cost) and the manual EXPENDITURE LOG.
- **Expenditure log (`machine_expenses`, migration 0009):** the spend that
  bypasses work orders — cash service, fuel, hire, consumables,
  subcontractor invoices. Kinds: service/contract/parts_direct/consumable/
  fuel/hire/calibration/training/other; vendor + invoice reference + actual
  occurred-at date; source manual|agent|import. Logged in naira (kobo
  integers underneath, `nairaToKobo`). Append-friendly: corrections DELETE
  (audited) and re-add — no edit path. Tenancy hardened: `add` refuses
  foreign-org machines outright.
- **The coherent rule (the important one):** work-order costs are NEVER
  duplicated into the new table. `maintenanceHistoryService.forMachine`
  rolls up labor (Σ minutes × rate / 60, rounded once) and issued-parts
  (Σ qty × issue-time unit cost) from the existing ledger tables at READ
  time, then adds manual expenses on top. Lifetime = WO-derived + logged;
  a 365-day window variant feeds the SPEND — LAST 12 MONTHS tile.
- Forms are plain server actions (progressive enhancement preserved — the
  no-JS protocol stays intact); only `plan.manage` roles may add/delete.
- Audited: `machine.expense_added` / `machine.expense_removed`.

**Tests/verification:** tsc clean; **142 passing (from the pre-sprint 135;
7 new)** — WO rollup math, last-service stamp from the latest concluded
card, open/concluded split, 365-day window exclusion of old manual spend,
soft-delete + audit + double-remove refusal, validation (positive integer
kobo, kind whitelist, description, foreign machine),
live cross-tenancy isolation, and the agent-facing summary shape that
sprint item 5 will wire the LLM tools onto.

**Next — item 2:** notes/docs with import support (reuse the document
store; MD first, CSV/XLSX second, PDF/DOCX preview only), then item 3
inline grid editing, item 4 demo-mode purchase module (Paystack test keys),
item 5 threading the agent through all of it ("show UKR chiller's last
service and spend" — the pitch moment).

## UPGRADE SPRINT item 2 — Notes & docs with imports + media attachments ✅

**Commit:** `machine notes — markdown notes + MD/TXT/CSV/XLSX import into the shared file-store (migration 0010 machine_notes), document preview page`

- **NOTES / DOCS tab is a new surface** on the machine profile: typed
  Markdown notes (title + body, 60k-char cap), rendered server-side by a
  new escape-first renderer (`src/lib/markdown.ts`) — headings, bold,
  italic, inline code, links (http(s)/same-origin only), lists,
  blockquotes, code fences. Raw HTML can NEVER survive rendering
  (`<script>` test proves it); zero client JS.
- **One file-store rule:** importing .md/.txt/.csv/.xlsx (≤5 MB) lands the
  ORIGINAL bytes in the existing document store (bytea, always
  downloadable) AND creates a self-contained note. MD/TXT come in
  verbatim; CSV/XLSX become a row-capped markdown table (first 100 data
  rows) with an explicit "N more rows truncated" pointer.
- **Media attachments stay on ATTACHMENTS** (the renamed documents tab,
  now with PREVIEW buttons). New preview page
  `/machines/[id]/docs/[documentId]`: images inline, PDF in the browser
  viewer (iframe), CSV/XLSX as server-rendered tables (200-row cap), text
  verbatim, DOCX/unknown get an honest download-only card. No data faked,
  nothing silently hidden.
- Progressive enhancement intact (plain server actions); audit entries
  `machine.note_added` / `machine.note_removed`; only `plan.manage`
  deletes; tenancy hardened on every path (foreign-org machine →
  `machine_not_found`).
- Dependency added: `xlsx` (SheetJS) — the one new package the sprint
  needs; everything else is dependency-free (CSV parser existed since M1).

**Tests/verification:** tsc clean; **156 passing (from 142; 14 new)** —
markdown renderer security (script/bold-in-fence/javascript-link attacks),
table truncation math, notes CRUD + audit + soft-delete, body size and
title fallbacks, cross-org invisibility for list/write/remove, real .md
import (document row verified), 150-row CSV truncated at 100 with cap
report, real SheetJS-built .xlsx workbook imported by sheet name,
unsupported/empty refusals with guidance, foreign-org import refusal.

**Next - item 3:** spreadsheet-style inline grid editing where profiles
need it, item 4 demo-mode purchase module (Paystack test keys + fake
ledger + DEMO banner), item 5 agent threading ("show UKR chiller's last
service and spend" - the pitch moment).

## UPGRADE SPRINT item 3 - spreadsheet-grid editing where profiles need it

**Commit:** `grid editing - rated-specs matrix on machine edit + BOM components grid on PARTS (no new tables, no client JS)`

- **No-JS grids, done properly:** a "grid" is a plain HTML table of inputs
  submitted by ONE server action - progressive enhancement intact (the
  no-JS protocol stays). Pure parsers live in `src/lib/grid.ts`
  (`parseSpecsGrid` / `parseComponentGrid`), so the tricky pairing rules are
  unit-tested, not buried in JSX.
- **Rated-specs matrix** on `/machines/[id]/edit`: every key of the
  machine's `rated_specs` jsonb renders as an editable key/value row + 3
  blank add-rows; a save is a FULL REPLACEMENT (a blank key or value removes
  the spec) since the grid renders the complete current set. Keys lowercased
  & capped; numbers stay numbers. New service
  `machinesWriteService.updateRatedSpecs` (tenant-guarded
  `machine_not_found`, audit `machine.specs_updated` with the resulting key
  list). `update()` now persists `ratedSpecs` too when passed.
- **BOM components grid** on the PARTS tab (planners only): existing
  machine_components rows edit in place (name/tag/kind/note), a DEL checkbox
  removes a row, 3 blank rows add components - one SAVE GRID submit carries
  update/delete/insert with per-row audits (`machine.component_updated` /
  `machine.component_removed` / `machine.component_added`). Unchecked
  checkboxes submit nothing, so the remove control is indexed
  (`comp_remove_<rowIndex>`) and resolved by key-scan - the pairing cannot
  shift when a middle row is ticked. Guessed/foreign ids throw
  `component_not_found` (org AND machine matched) - never edit blind. The
  standalone ADD COMPONENT form is folded into the grid (action removed).
- **Fix while wiring:** sprint items 1/2 error banners were silently dead -
  actions redirect with `expense_error=` / `note_error=` query keys but the
  profile page read camelCase `sp.expenseError` / `sp.noteError` (Next.js
  does not camelize search params). Both now read the literal keys.

**Tests/verification:** tsc clean; **168 passing (from 156; 12 new)** -
pairing rules (blank removals, numeric conversion, lowercase+dedupe
last-wins), indexed-checkbox alignment, full-replacement specs save with
audit key list, `update()` persistence, cross-org guard, machine-scoped
`component_not_found` for update/remove/guessed ids, and a simulated
partial-grid save (rename two / DEL one / blank add-rows) saying 1 updated - 0
added - 1 removed, listing the survivors.

**Next:** item 4 - demo-mode purchase module (Paystack test keys, fake
ledger, clear DEMO banner), then item 5 - thread the agent through all of
it ("show UKR chiller's last service and spend" - the pitch moment).


