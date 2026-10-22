# Cogitex Maintenance Planner — Open Questions (blocking / to confirm)

Per brief §10: blockers are listed here instead of being silently assumed. Nothing below is invented;
each item names who needs to answer and what it unlocks.

## Blocking for build decisions

1. **Project location + repo home.** I scaffolded planning docs in
   `C:\Users\Mike Edeimu\cogitex-maintenance-planner\` (new folder, git-initialized). Confirm or
   give a target path/repo (GitHub? which org?). Unlocks M0 commit history conventions.
2. **VIDE's real backend stack + production URL.** The console points at `http://127.0.0.1:8000/api`
   (a local dev box). What runs there (FastAPI? which DB?), and where does it run in production?
   Unlocks M4 real-adapter work and whether we adopt VIDE's DB conventions (Prisma vs our Drizzle
   default). Also: do the `machines.html / devices.html / diagnostics.html / predictions.html`
   pages exist elsewhere? Only `index.html` was in the folder.
3. **Shared identity/SSO does not exist yet in VIDE.** Plan until it does: our own Auth.js
   (email + password / magic link). OK to lead with that? If VIDE will provide SSO sooner, we'd hold
   M0 auth behind the `IdentityClient` adapter from day one (already planned).
4. **Design token confirmation a11y tweak.** Tokens extracted verbatim from `index.html`.
   One proposed change: raise body-size floor to 12px for readability on phones and keep the
   9px eyebrows for decorative labels only (WCAG AA checks on `--dim` text). Approve?

## Needed from the VIDE / Cortex team (contracts marked PROPOSED)

5. **Integration endpoints existence/shape.** The console only proves
   `/health/detailed`, `/machines`, `/readings/recent/{machine}`, `/diagnostics/critical-events`,
   `POST /diagnostics/analyze`, firmware `POST /api/readings`. We need (INTEGRATION_CONTRACTS §2–3): machine directory with device mapping, health score/RUL, energy summaries, runtime hours, fault history, device status. Do any exist? If not, does the VIDE team accept the PROPOSED spec as their build spec?
6. **Outbound webhooks.** `fault.raised`, `fault.cleared`, `device.offline/online` (+ optional
   `health.snapshot`) — confirm event ids are stable, HMAC scheme acceptable
   (`X-Cogitex-Signature` sha256 over raw body + timestamp, 5-min skew), and the endpoint URL they'll POST to.
7. **Lifecycle write-out + root-cause feedback endpoints** (`POST /integration/machines/{machine_name}/lifecycle`,
   `POST /integration/faults/{event_id}/confirmed-root-cause`) — confirm or propose alternatives.
   Blocks M5's "improve fault models" loop.
8. **Marketplace service.** Does it exist with a test/sandbox environment? If not yet, confirm that
   the `MarketplaceClient` interface + webhook envelope (§4/§6) is the contract they build toward.
   Also: how do we display subscription status / job credits in our UI (they own billing)?
9. **Shared notification service.** Push/WhatsApp/SMS: is there an existing relay we should adapt to?
   Until then, in-app + email only. Which email provider is allowed (SMTP creds?)?

## Needed from the org / product owner (you)

10. **Auth policy details.** M0 shipped built-in auth (email + password, jose HS256 signed cookie,
    scrypt credentials). Still open: magic-link/2FA need, session lifetime beyond 30d.
    (External technicians will get marketplace-side accounts.)
11. **File storage + uploads.** Local disk volume vs S3-compatible object storage? Any antivirus
    scanner to wire into the upload hook (e.g. ClamAV service)?
12. ~~Deployment target~~ **RESOLVED** — Vercel + Neon Postgres for the shareable demo
    (background-job mechanism unaffected: DB-backed queue works either way).
13. **LLM provider for the agent.** Which gateway/provider+model (e.g. an OpenAI-compatible relay)?
    Any max token budget per day per org to enforce?
14. **Timezone policy.** Africa/Lagos org-wide default (already planned) — is per-user display tz
    ever needed?
15. **Rounding/agreement.** Metric rounding + "10% grace" for PM compliance acceptance (DATA_MODEL §5) — approve the first-version definitions?

## Resolved by inspection (no action needed)

- ~~Design tokens (colors/type/shape/behaviors)~~ **RESOLVED** — extracted; see ARCHITECTURE §3.
- ~~Project location~~ **RESOLVED** — `cogitex-maintenance-planner/` next to the VIDE folder, git repo initialized; docs + M0 committed.
- ~~Deployment target~~ **RESOLVED** — Vercel + Neon Postgres for the shareable demo (ARCHITECTURE stack table; README has steps).
- Machine tag ↔ VIDE `machine_name` mapping lives in our `machine_devices` table (in-app, not VIDE).
- VIDE owns health scoring labels: `healthy/watch/warning/critical`; score mapping 100/75/50/20 mirrors the console.
