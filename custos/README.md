# CUSTOS — Task Guardian (Cogitex suite)

Custos (Latin: *the guardian*) is the WhatsApp follow-through app of the
Cogitex suite — the companion to **ORGO** (the Maintenance Manager).
The owner sets tasks in this dashboard; staff receive them in ordinary
WhatsApp (no app install, no login); ticks, numbers and photos flow back;
silence escalates to the supervisor, then the owner.

Design language, conventions and the database discipline are shared with the
Planner (`../cogitex`): ops-notebook paper UI, integer-kobo money, UTC
timestamps displayed in Africa/Lagos, org-scoped everything, append-only
audit, no client JS on surfaces that don't need it.

## Status (build order — brief §12)

| Milestone | What | Status |
|---|---|---|
| M0 | Security: signup can never overwrite an account; expiring single-use reset tokens | **built in from day one** (tests enforce it) |
| M1 | Data model + messaging adapter + simulator screen | **done** — bot tables live; `MessagingProvider` adapter (simulator + M7 stub); one inbound pipeline with wa-id dedupe; one messages file; media store outside the web root; phone chat screen, zero client JS |
| M2 | Registration (START/STOP), unregistered numbers, role menus | **done** — People page (dashboard intake, one number per workspace); person-owned START/STOP with one-confirm-then-silence; pending waits for START; patient role-aware menus (staff get problems, heads get team status) |
| M3 | Task + proof loop with evidence + dashboard proof | **done (core loop)** — task set on the Today desk → agent pushes instantly → person taps → sends any media (photo/video/audio/PDF, ≤16 MB) → typed full-name signature → done; proof feed shows kind chips + signatures on the heads' desk; readings/checklist types remain |
| M4 | Agent heartbeat: summary, reminders, escalation | **done (demo-speed)** — `/api/cron/agent` (Vercel Cron, CRON_SECRET-guarded): overdue flip, reminders every ≥12 h (escalation_level bumps), daily digest once per 24 h per person (audit-gated) |
| M5 | Problems → jobs (technician close with photo + cost); gas count/refill/burn-rate | — |
| M6 | Reports: metrics from code, owner `report` command, HTML report page | — |
| M7 | WhatsApp mode: Meta Cloud API provider, signed webhook, media download, templates | — |
| M8 | Hardening: idempotency replays, failed-delivery handling, README ops | — |

## Deploy today (Vercel + Neon)

Custos is a pure SaaS: separate Vercel project, separate database.

1. **Neon** (free): create the `custos` database → copy the **pooled** connection string.
2. **Vercel**: New Project → import `vide-suite` (GitHub) → **Root Directory: `custos`** → framework auto-detects Next.js.
3. **Env vars** (Vercel → Settings → Environment Variables):
   - `DATABASE_URL` = the Neon pooled URL (required in production)
   - `AUTH_SECRET` = 32-byte random base64
   - `CRON_SECRET` = a long random string (guards `/api/cron/agent`)
   - `MESSAGING_MODE` = `simulator` (leave until M7 wants real WhatsApp)
4. **Schema once**: from a machine with the repo (`vide-suite/custos`), with `DATABASE_URL` set to the Neon pooled URL:
   `npx drizzle-kit migrate` (add `NODE_OPTIONS=--tls-max-v1.2` if TLS complains).
5. **Webhook/admin note**: media bytes default to the OS temp dir (Vercel read-only-safe); set `CUSTOS_MEDIA_DIR` when you move to a persistent volume or object storage.

## APIs you need to test this

| Layer | Need | Where |
|---|---|---|
| Simulator loop (today) | **Nothing external** — no API keys at all. Everything runs in the app: `npm run dev` → :3040, sign up, add people, set tasks, chat as them. | this repo |
| Agent heartbeat | `CRON_SECRET` only (any random string) — it guards `/api/cron/agent`; local dev runs without it; `curl -H "x-cron-secret: $CRON_SECRET" https://your-app/api/cron/agent` | Vercel env |
| Database | `DATABASE_URL` — a Neon (or any Postgres) connection string | Vercel + drizzle-kit |
| Real WhatsApp (M7) | A Meta developer account + WhatsApp Cloud API: `WA_BUSINESS_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`, `WA_APP_SECRET` (for the signature check), `WA_WEBHOOK_VERIFY_TOKEN`, plus the webhook URL `https://your-app/api/webhooks/whatsapp` and template approvals for the strings in `src/lib/bot/messages.ts` | Meta developer portal |
| Password-reset email (stubbed) | Any SMTP/Resend key later | — |

## Stack

Next.js (App Router) · TypeScript strict · Drizzle ORM + PostgreSQL (PGlite in
dev/tests, own Neon DB in production — separate from the Planner's) · Tailwind ·
zod · jose (session JWT) · Vitest. Dev server: `npm run dev` → :3040.

## Non-negotiables

- The bot logic never knows which messaging mode it is in — one adapter
  interface, two providers (simulator, Meta Cloud API).
- Every WhatsApp-facing string lives in **one** messages file (`src/lib/bot/messages.ts` when it lands).
- Tenant isolation tested explicitly; webhook handlers idempotent by design.
- Secrets only in env (see `.env.example`). No unofficial WhatsApp libraries, ever.

## Run

```bash
npm install
npm run dev        # http://localhost:3040
npm test           # vitest (tenancy + security-first)
```
