# VIDE SUITE — Project Documentation

**VIDE CORTEX (console) + Cogitex Maintenance Planner (CMMS)**
*Baseline document — full build state as of Friday, 24 October 2026. Prepared by Mike Edeimu with OpenCode (GLM-5.3-Flash). Version 1.0 — issued before the "Documentation / Multimedia / Machine Profiles / Purchase" upgrade sprint.*

---

## 1. Executive summary

VIDE SUITE is an industrial IoT monitoring + maintenance product delivered as **two Next.js applications that behave as one product**:

- **VIDE CORTEX** — the live fleet console: fleet overview, machine diagnostics, device simulations (SIM), local-model predictions and an AI analyst chat grounded in real database facts.
- **Cogitex Maintenance Planner** — the CMMS: machines registry, maintenance planning, work orders, faults, inventory, repairs, reports and an LLM maintenance agent.

The two apps share **one account and one password** through a hand-rolled, signature-verified SSO exchange (JWT via `jose`, 5-minute single-use tokens, host allow-listing). A SIM engine in the console can feed the planner's database through a machine-to-machine webhook, so ONE login + ONE data spine drive both surfaces.

**Current state (all verified live):**

| Area | Status |
|---|---|
| Local development suite (`:3000` + `:3030`) | Running, both health-checked |
| Deployed suite (Vercel, production) | `vide-suite-cortex.vercel.app` + `vide-suite-cogitex.vercel.app` — both live |
| One-login SSO chain (deployed) | Proven: front door → VIDE login → signed token → planner session |
| SIM → planner ingestion bridge (deployed) | Proven: 30 machines (3 sites), 7 faults, 7 telemetry snapshots written to Neon in one push |
| Database (production) | Neon Postgres (`ep-shy-bread-za8xwczx-pooler`, eu-west-2/London), schema migrated |
| Tests / type-safety | 134/134 tests passing (last recorded run), `tsc --noEmit` green on both apps |
| Repository | `https://github.com/emf187/vide-suite.git` (single repo, two rooted apps) |

---

## 2. The two applications

### 2.1 VIDE CORTEX (console) — port 3000

Tabs and capabilities:

- **Overview** — fleet health tiles (glass tiles with live state colors: fleet online/health/anomalies), headline KPIs.
- **Machines** — per-machine detail: temperature/vibration telemetry, threshold breaches, health status.
- **Devices** — device registry view.
- **Diagnostics** — fault triage surface with machine-linked analysis.
- **Predictions** — locally computed failure-risk indicators (no cloud LLM dependency for the base math).
- **Agent chat** — multi-turn chat grounded in the *actual* database snapshot with citations; honest degradation (never simulates numbers — reports outages instead).
- **SIM** — the suite-wide simulation switch; spins the demo fleet (30 machines / Ota Plant, Agege Works, Ikorodu Yard) and can push a full digest into the planner.
- **Topbar** — connection state badge (backend URL / mock mode control via SOURCE panel), PLANNER hand-off button, suite-wide SIGN OUT, theme toggle.

### 2.2 Cogitex Maintenance Planner — port 3030

- **Today** — live dashboard: greeting + initials chip, color-coded stat tiles (FLEET / DUE THIS WEEK / LOW STOCK / anomalies) driven by real health state.
- **Machines** — machine registry with detail views.
- **Planning** — maintenance calendar/PM planning.
- **Work Orders** — create/track order lifecycle.
- **Faults** — fault board fed by the ingest webhook (severity: warning/critical).
- **Inventory** — spare parts and stock levels with low-stock warnings.
- **Repairs** — repair execution records.
- **Reports** — printable summaries.
- **Agent** — LLM maintenance assistant with tool-use (query DB facts, create work orders from chat), citation-backed answers.
- **Settings / Locations / About** — configuration and meta pages.

### 2.3 What makes it "one suite"

- One login: created inside either app door; the other app accepts it automatically.
- Suite-wide logo marks (V / C gradient tiles), shared design language (warm industrial palette, glassmorphism, gradient buttons, tracked-uppercase labels).
- SIM state and ingest webhooks connect the console's fleet to the planner's registry in real time.

---

## 3. Architecture

### 3.1 Repository layout

```
vide-suite/                    (GitHub: emf187/vide-suite, branch main)
├── README.md                  (deploy guide + env matrix)
├── vide-cortex/               (VIDE CORTEX — Next.js app, Vercel root "vide-cortex")
└── cogitex/                   (Cogitex Planner —  Next.js app, Vercel root "cogitex")
```

Working copies kept locally:

- `OneDrive\Belgeler\vide manage\VIDE MAIN\VIDE-WEB-APP-nextjs-rebuild` (VIDE, branch `master`)
- `C:\Users\Mike Edeimu\cogitex-maintenance-planner` (Cogitex, branch `main`)

Every change flow: working repo → commit → mirrored into `vide-suite` → push → Vercel auto-deploys both projects (each project builds only its root directory).

### 3.2 Technology choices (with reasons)

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router) both apps | one mental model, server actions for no-JS-safe forms |
| Database (prod) | Neon Postgres via `postgres.js` (`prepare: false`, serverless/pooler-safe) | Vercel compatibility; low-latency region match (function region lhr1 ≈ Neon eu-west-2) |
| Database (dev) | PGlite on-disk (`./.pglite`) + self-migration | instant dev boot; persistent real data locally; never delete |
| ORM | Drizzle | typed schema + migrations committed in `drizzle/` |
| Sessions | HMAC-signed JWT via `jose`, httpOnly cookie | no external store; verified signature on every app entry |
| Forms/actions | React Server Actions with **progressive enhancement** | the operator's Edge often kills hydration — all critical flows must work with JS off (proven by the no-JS test protocol) |
| LLM | OpenRouter (chat + agent tool-use) | model-agnostic; honest outage reporting instead of fake data |
| Simulation | In-process SIM engine (`MOCK_FLEET`, 30 machines) + `.sim-state.json` flag | instant demo, deterministic; write-time best-effort on serverless |

### 3.3 Key modules (map)

| Path | Role |
|---|---|
| `vide-cortex/src/lib/auth/session.ts` | JWT session create/verify (`vide_session`) |
| `vide-cortex/src/lib/auth/sso.ts` | handoff-target allow-list validation (`VIDE_SSO_ALLOWED_HOSTS`) |
| `vide-cortex/src/app/login/actions.ts` | sign-in via planner verify + account-create via planner provision |
| `vide-cortex/src/app/api/sim/route.ts` | SIM status / toggle / full-digest push to planner |
| `cogitex/src/middleware.ts` | front-door: stranded visitors → VIDE login `?sso=` |
| `cogitex/src/app/api/auth/suite-verify/route.ts` | password verification for VIDE sign-in |
| `cogitex/src/app/api/auth/suite-provision/route.ts` | account create/reset for the CREATE ACCOUNT door |
| `cogitex/src/app/api/auth/sso/route.ts` | token exchange → `cogitex_session` |
| `cogitex/src/app/api/webhooks/vide/route.ts` | machine/fault/readings ingest (org-claimed, name-keyed) |
| `cogitex/src/server/db/client.ts` | PGlite (dev) vs Postgres (prod) single-source DB client |

---

## 4. The one-login SSO system (how it works)

1. **Sign in at VIDE** (`/login`, server action). VIDE calls Cogitex `POST /api/auth/suite-verify` (Bearer shared secret + email/password). Policy: *VDIE never stores passwords* — the planner is the single password authority.
2. **CREATE NEW ACCOUNT door** — VIDE calls `POST /api/auth/suite-provision` (create-or-reset semantics: re-used email sets a new password; provisioning also creates the plant organization).
3. **Front door auto-handoff** — opening the planner while holding only a VIDE session triggers Cogitex middleware: redirect → `vide login?sso=<planner /api/auth/sso?next=/today>`.
4. **Token exchange** — VIDE validates the `sso` target: absolute URL, path must start `/api/auth/sso`, **hostname must be on `VIDE_SSO_ALLOWED_HOSTS`** (missing list ⇒ silently refused — this was a production incident, fixed). VIDE mint a 5-minute aud-tagged token → redirect back.
5. **Session minted** — Cogitex verifies token signature + audience + expiry, sets `cogitex_session`, bounces to `/today`. Zero typing, ever.
6. **Cold-start race hardening** — VIDE login retries the verify call on network failure (provision/verify retry for cloudy cold starts).

**Environment variables that make it work (both apps):**

```
AUTH_SECRET            (identical shared secret in both apps signs sessions + endpoints)
VIDE_LOGIN_URL         (cogitex → where to send stranded visitors: <cortex host>/login)
COGITEX_PUBLIC_URL     (cogitex's own origin; used to build exchange URLs)
VIDE_SSO_ALLOWED_HOSTS (cortex-side allow-list of hosts allowed to run the exchange)
COGITEX_VERIFY_URL     (cortex → planner verify endpoint)
COGITEX_PROVISION_URL  (cortex → planner provision endpoint)
NEXT_PUBLIC_SUITE_COAPP_URL  (both: cross-app deep links; NEXT_PUBLIC_* are BAKED AT BUILD TIME)
```

---

## 5. The SIM bridge (console → planner data feed)

- `POST /api/sim {"action":"toggle"}` flips the suite-wide SIM switch (persisted best-effort in `.sim-state.json`; on Vercel writes no-op so the flag lives in function memory — default **ON** on cold starts).
- Full-digest push (`POST /api/sim` no body / legacy button) composes **30 machine upserts + current fault events (warning/critical breaches) + telemetry snapshot pre-warm** and POSTs to the planner's ingest webhook with header `x-webhook-secret: <COGITEX_INGEST_SECRET>` (planner side env: `WEBHOOK_SECRET`).
- Ingest semantics: payload org slug `"*"` resolves to the **single org** of a small deployment (zero-config demo); machines resolve **strictly by VIDE machine name** inside the claimed org — payload ids/orgs are never trusted.
- Live proof (production, after the timeout fix): `ok:true, pushed: {machines:30, faults:7, snapshots:7, sites:3}` in **~26.5 s**.

**Why the timeouts were raised (incident):** serverless cold function + Neon waking from suspension + ~44 sequential writes legitimately exceed the original 15 s client abort. Fixes: client timeout 15 s → 45 s; `maxDuration = 60` on both the SIM route and the ingest webhook. Committed in `vide-cortex` (02d1862) and `cogitex` (86547ba), mirrored to the suite repo (40dbb86).

---

## 6. Deployment

### 6.1 Topology

| Piece | Value |
|---|---|
| Vercel projects | `vide-suite-cogitex`, `vide-suite-cortex` (Hobby team, GitHub-integrated) |
| Production domains | `https://vide-suite-cogitex.vercel.app`, `https://vide-suite-cortex.vercel.app` |
| Database | Neon project "cogitex" / branch production / endpoint `ep-shy-bread-za8xwczx-pooler.c-2.eu-west-2.aws.neon.tech` (london) |
| Repo | `https://github.com/emf187/vide-suite.git` — pushes auto-deploy both projects |
| Schema management | `npx drizzle-kit migrate` run locally with `DATABASE_URL` pointed at Neon |

### 6.2 Deploy order (matters)

1. Cogitex first (it hosts verify/provision/ingest), 
2. then VIDE (its env rows point at real domains), 
3. one cogitex redeploy if any URL rows ever change.

### 6.3 Rule of thumb durante incidents

- URL changes to `NEXT_PUBLIC_*` require a **new build** (they're baked at build time — a simple env update without Redeploy changes nothing).
- `404 DEPLOYMENT_NOT_FOUND` on a link = you clicked a *per-build preview URL*; use the production domains only.
- Per-deploy preview URLs die when superseded — never appoint them as product links.

---

## 7. Progress journey & milestones (annotated)

### Phase 1 — One-login suite (built and proven)

- `ab0c7cd` (vide) — CREATE ACCOUNT door (suite-provision).
- `680f6d2` (cogitex) — suite-provision endpoint (create / reset-password semantics).
- `eacaa3f` (cogitex) — front-door automatic handoff (`/` and `/login` continue a suite session) via `src/server/auth/sso.ts`.
- `3c50998` (vide) — planner-verify network retry (cold-start race).
- Verified live then: cookie chain `vide_session → token → cogitex_session → live /today with FLEET tile`. Multi-turn agent chat with citation-backed DB answers. Tests 134/134; tsc green both apps.

### Phase 2 — Aesthetic sweep (goal: slick, future-proof, professional, mobile-first)

- Per-tab inline SVG icons in both sidebars (16px Cogitex / 15px VIDE, stroke `currentColor`) — Machines = gear; no image assets to deploy.
- Login pages became gradient-mesh + glassmorphism cards (auth-mesh background, glass card, gradient SIGN IN / outlined CREATE, alert chips with dots, brand watermarks). Commits: vide `d306d35`, cogitex `6be5d5f` (+ dark-theme gradient tokens).
- Stat tiles went health-state-aware (red when critical faults open, amber on warnings) — `/today` via a typed `stateStyle` map, VIDE overview via Tile `state` + `glass` props. Commits vide `8b8d6ec`, cogitex tile/avatar pass `88ae660`.
- Toasts, cards, tiles → glass surfaces; toasts translucent blurred pills.
- Mobile pass: ≥16px inputs (no iOS zoom), 44px touch targets, tiles stack <480px, topbar controls wrap, titles truncate, Cogitex floating **MENU** pill (accessible `aria-expanded`, close state), sidebar icons aligned in flex rows. Commits: vide `fea2ea7`, cogitex `05c2b61`.
- Full SSO front-door chain re-proven after every pass (regression discipline). Documentation commits: `cf5ee36`, `338f0a2` (milestone log), handoff doc updated.

### Phase 3 — Deploy day (2026-10-22) — the saga and its fixes

Journey artifacts: repo `emf187/vide-suite-` created → combined monorepo assembled locally (mirror of both apps; secrets and dev DB properly excluded) → pushed. Vercel import flow (two single projects). Neon database created (first-project walkthrough; Better Auth toggle correctly left OFF), schema migrated from local with `drizzle-kit`.

Four production incidents found and fixed (each with root cause + teaching):

1. **Whole home-directory git area accident** — a path-with-spaces mistake made `git init` run in the $HOME dir and stage everything (nothing committed/pushed). Fixed by safe deletion of the stray `.git`; discipline: always use the tool's explicit work-dir parameter.
2. **Inert login page ("page like a picture")** — `.auth-mesh` was `position:fixed` + `pointer-events:none` **as the page container**, which inherited into every input: the whole login was unclickable, and phones couldn't scroll. Root-cause fix in both apps: container became a normal relative background layer (`a412edc` vide, `476f31e` cogitex, suite mirror `cbb3593`). Lesson recorded: HTTP-based tests cannot see pointer-events; keep one manual interaction check per transport change.
3. **Planner handoff silently bouncing back** — `VIDE_SSO_ALLOWED_HOSTS` was missing from the cortex project env; the target-host allow-list default (`localhost`) refused the real planner host and the login page fell back to `redirect("/")` (looks like "the app just reloads"). Fixed by adding the row (deployment) and documenting it in `.env.example` + README (suite commit `ce54875`).
4. **SIM push timing out at 15 s** — legitimate serverless cost (Neon wake + ~44 event writes) exceeded the tight abort. Fixed with 45 s client timeout + `maxDuration=60` on both routes; full push later proven at ~26.5 s.

Deployment was completed cleanly with a fresh import after a rough first day (old suffixed-domain project deleted, names exact, production domains stable).

### Phase 4 — Viability pass (2026-10-24)

Honest product rating recorded (see §10) and the "before code" decision made to document first, then build in agreed order.

---

## 8. Quality gates & verification protocol

- **Type gates:** `npx tsc --noEmit` per repo (must be green before any commit).
- **Test suites:** cogitex 134/134 (last recorded full run), vitest.
- **No-JS protocol (the suite's signature testing method):** because the operator's browser often dies on hydration, every critical flow is exercised as **plain HTTP forms** — parse `$ACTION_ID_…` from served HTML, POST server-action forms, follow the chain with cookie jars (`%TEMP%\opencode\suite-frontdoor-test.js` is the canonical script pattern).
- **Live chain proof:** provision (create-or-reset) → VIDE sign-in 303 → planner `/` 307 → SSO hops → `/today` 200 with FLEET content.
- **Webhook bridge proof:** signature header comparisons; minimal 3-event probe (200, 3.8 s incl. Neon wake) and full 44-event proof (200, ~26.5 s).
- **Manual interaction check:** after any transport/CSS change, confirm the login still accepts focus/typing in a real browser (pointer-events lesson).

---

## 9. Environment matrix (deploy reference)

**Both projects:**

```
AUTH_SECRET=<identical shared secret>
NEXT_PUBLIC_SUITE_COAPP_URL=<other app's production origin>
```

**Cogitex only:**

```
DATABASE_URL=<Neon pooled connection string>   # must contain "-pooler"
COGITEX_PUBLIC_URL=https://vide-suite-cogitex.vercel.app
VIDE_LOGIN_URL=https://vide-suite-cortex.vercel.app/login
NEXT_PUBLIC_SUITE_COAPP_URL=https://vide-suite-cortex.vercel.app
AGENT_LLM_API_KEY=<OpenRouter key>
AGENT_LLM_BASE_URL=https://openrouter.ai/api/v1
AGENT_LLM_MODEL=<chosen model>
WEBHOOK_SECRET=<shared webhook secret — must equal VIDE's COGITEX_INGEST_SECRET>
```

**VIDE only:**

```
COGITEX_VERIFY_URL=https://vide-suite-cogitex.vercel.app/api/auth/suite-verify
COGITEX_PROVISION_URL=https://vide-suite-cogitex.vercel.app/api/auth/suite-provision
COGITEX_INGEST_URL=https://vide-suite-cogitex.vercel.app/api/webhooks/vide
COGITEX_INGEST_SECRET=<same as WEBHOOK_SECRET>
VIDE_SSO_ALLOWED_HOSTS=vide-suite-cogitex.vercel.app,vide-suite-cortex.vercel.app
NEXT_PUBLIC_USE_MOCKS=true
OPENROUTER_API_KEY=<OpenRouter key>
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=<chosen model>
```

Generate secrets:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Pending rotations (declared):** OpenRouter key and Neon password (both transited chat during setup). Do it together, then update `.env.local` files + Vercel envs + redeploy both.

---

## 10. Product viability assessment (honest, pre-upgrade)

| Lens | Rating | One-line reason |
|---|---|---|
| Portfolio / pitch artifact | **8.5 / 10** | functioning two-app suite with SSO, real DB, honest AI — rare at this scale |
| Niche SaaS (small/mid industries, emerging markets) | **6 / 10 if ideally functioning** | real gap (paper + WhatsApp + Excel), but sales depends on trust + distribution, not code |
| Category competitor (vs UpKeep/MaintainX/Limble/Fiix/eMaint…) | **3 / 10** | feature-parity race against funded incumbents is a losing game solo |
| Foundation for the real product | **7 / 10** | architecture choices (no-JS actions, M2M webhooks, honest LLM) age well |

**What separates demo from ideal product (priority order):**

1. **A real data path** (device gateway / MQTT / Modbus / OPC-UA — or an honest manual CSV/logbook ingest for pilots). The SIM is the demo; telemetry ingestion *is* the product.
2. **Real multi-tenancy + RBAC** (org isolation, technician/manager/buyer roles, audit log).
3. **Security hygiene for buyers** (OIDC option, MFA, export/backup story).
4. **Distribution:** one real plant piloted manually beats any feature.

**Upgrade sprint (agreed order, "don't over-engineer purchases yet"):**

1. Machine profile v2 + maintenance history + expenditure log (one coherent data model)
2. Notes/docs with import support (MD first; CSV/XLSX; PDF/DOCX preview) + media attachments
3. Spreadsheet-style inline grid editing where profiles need it
4. Purchase module, demo-mode only (test keys + fake ledger + clear DEMO banner)
5. Thread the AI agent through the new data (e.g. "show this machine's last service and total spend")

**Open strategic decision:** target (a) pitch/demo polish vs (b) one real plant pilot. The answer reorders items 1–5 (pilot would front-load the manual ingest path first).

---

## 11. Operations runbook (local)

```
LAUNCH (always — never plain `npm run dev`, TLS middlebox):
%TEMP%\opencode\vide-dev.cmd        → :3000
%TEMP%\opencode\cogitex-dev.cmd     → :3030
(both set NODE_OPTIONS=--tls-max-v1.2)

RESTART:
Get-NetTCPConnection -LocalPort <p> -State Listen  → taskkill /PID <pid> /T /F
→ Start-Process <launcher> -WindowStyle Hidden → wait ~20 s → health check
```

- **Edge rule:** after any restart/deploy, hard-refresh tabs (Ctrl+Shift+R) — stale tabs caused most "it doesn't work" confusion.
- **Dev DB:** `./.pglite` under the cogitex folder is **persistent, never delete** (hosts real test accounts).
- **Test accounts (local):** `suite-op-1@factory.demo` / `wrench-brave-42`; `ada.obi@lagoonworks.demo` / `iron-bloom-51` (org Lagoon Works Ltd).
- **Ports smoke:** `/login` 200 (VIDE), `/login` 307 (Cogitex, suite-mode redirect), `/today` 307 without session (correct), `/api/auth/suite-verify` 405 (alive).
- **Never** run `npm run build` while a dev server holds ports; never commit `.env*` files.

### Known issues / tech debt (tracked)

| # | Issue | Severity | Note |
|---|---|---|---|
| 1 | SIM on/off flag lives in function memory on Vercel (file write no-ops) | Low | cold start ⇢ default ON; acceptable for demo, DB-backed toggle later |
| 2 | Leftover probe machine `BRIDGE-TEST-UNIT` in Neon | Cosmetic | purge on request |
| 3 | Dark-mode persistence + "middle-click diagnostics" meaning | Unclarified | asked user twice; will confirm when relevant |
| 4 | Old orphan repo `emf187/vide-suite-` on GitHub | Cosmetic | safe to delete; superseded by `vide-suite` |
| 5 | Ingest writes are sequential (~40+ roundtrips) | Medium | batching (single multi-row insert) would cut push time to seconds |
| 6 | `NEXT_PUBLIC_*` baked at build → URL changes need redeploy | Info | documented; routine |
| 7 | Secrets rotation pending (OpenRouter, Neon) | Medium | declared; do together soon |

---

## 12. Where files live (handy map)

| Artifact | Path |
|---|---|
| Suite repo (local) | `C:\Users\Mike Edeimu\vide-suite` |
| VIDE working repo | `C:\Users\Mike Edeimu\OneDrive\Belgeler\vide manage\VIDE MAIN\VIDE-WEB-APP-nextjs-rebuild` |
| Cogitex working repo | `C:\Users\Mike Edeimu\cogitex-maintenance-planner` |
| Cogitex milestones log | `cogitex\docs\MILESTONES.md` |
| Suite overview + deploy matrix | `OneDrive\Belgeler\vide suite\SUITE.md` |
| Handoff notes | `OneDrive\Belgeler\vide suite\NEMOTRON-HANDOFF.md` |
| Dev launchers + no-JS test scripts | `C:\Users\Mike Edeimu\AppData\Local\Temp\opencode\` |
| Vercel env snapshot (editable source) | `C:\Users\Mike Edeimu\Downloads\vide-suite-cogitex.env`, `vide-suite-cortex.env` |
| This document | `OneDrive\Belgeler\cogitex asses\VIDE-SUITE-Project-Documentation-2026-10-24.pdf` |

---

*End of document — VIDE SUITE Documentation v1.0. Next revision will follow the upgrade sprint (§10.5).*
