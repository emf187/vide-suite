# ORGO — Maintenance Manager

"Notion for maintenance": documentation, planning and inventory for factory maintenance teams.
Reads live machine health/energy/faults from **VIDE** + **Cortex**, and is a client of the
repair-requests marketplace. Previously codenamed **Cogitex** — internal identifiers (session
cookie, test data, log prefixes, the `cogitex` folder in the mirror repo) keep the codename for
continuity; every user-visible surface now says **ORGO**.

- Planning docs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
  [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) ·
  [`docs/INTEGRATION_CONTRACTS.md`](docs/INTEGRATION_CONTRACTS.md) ·
  [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md)
- Design language: ported 1:1 from the VIDE main app console (see ARCHITECTURE §3).

## Stack

Next.js (App Router) · TypeScript strict · Drizzle ORM + PostgreSQL (PGlite in dev/tests) ·
Tailwind · zod · jose (session JWT) · Vitest. Money = integer kobo, timestamps UTC, display Africa/Lagos.

## Quickstart

```bash
npm install
npm run dev          # no DATABASE_URL needed: in-process PGlite dev DB (resets each restart)
```

Open <http://localhost:3000> → create an account (you become the org Owner), or seed first:

```bash
DATABASE_URL=postgres://... npm run db:migrate   # if using a real database
DATABASE_URL=postgres://... npm run seed          # demo org + demo1234 users
```

Useful scripts: `npm run typecheck`, `npm test`, `npm run db:generate` (after schema edits), `npm run build`.

## Deploy to Vercel (share the demo)

1. **Create the database:** a free Postgres at [neon.tech](https://neon.tech) (or Vercel Postgres) → copy the pooled `DATABASE_URL`.
2. **Push migrations once:**
   ```bash
   DATABASE_URL="<paste>" npm run db:migrate
   ```
3. **Import the repo on Vercel** (vercel.com/new). Framework: Next.js (auto-detected).
4. **Environment variables:** set `DATABASE_URL` and `AUTH_SECRET`
   (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
5. Deploy → share the URL. Your friend creates an account in ~30 seconds and is instantly the Owner of their own org (tenancy is isolated end-to-end).

Optional: `INTEGRATION_PROFILE=real` + `VIDE_API_BASE_URL` switches the VIDE adapter from
fixtures to the real console API (VERIFIED endpoints only — see INTEGRATION_CONTRACTS.md).

## Milestones

M0 (this branch) scaffold, tokens, auth, tenancy/roles, integration interfaces + mocks, CI.
Next: **M1** machine registry + profile + lifecycle + CSV import. Full map: docs/ARCHITECTURE.md §12.
