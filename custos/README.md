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
| M2 | Registration (START/STOP), unregistered numbers, role menus | consent primitives + rules already tested; screens next |
| M3 | Task types end-to-end with evidence + dashboard proof | — |
| M4 | Scheduler: morning summary, reminders, escalation (demo-speed switch) | — |
| M5 | Problems → jobs (technician close with photo + cost); gas count/refill/burn-rate | — |
| M6 | Reports: metrics from code, owner `report` command, HTML report page | — |
| M7 | WhatsApp mode: Meta Cloud API provider, signed webhook, media download, templates | — |
| M8 | Hardening: idempotency replays, failed-delivery handling, README ops | — |

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
