# VIDE SUITE

One industrial IoT suite, two Next.js apps, **one login**:

| Folder | App | What it is |
|---|---|---|
| `vide-cortex/` | **VIDE CORTEX** | live fleet console — SIM fleet telemetry, machine diagnostics, local-model predictions, chat, SIM switch |
| `cogitex/` | **Cogitex Maintenance Planner** | maintenance planning — machines, work orders, faults, inventory, agent chat, reports |

**One login works everywhere**: sign in once at VIDE (`/login`) and the planner session is minted automatically whenever you open Cogitex — the front door, deep links, and the PLANNER ↗ button all continue the suite session through `POST /api/auth/sso` with an aud-checked 5-minute token. The **CREATE NEW ACCOUNT** door on the VIDE login provisions the plant workspace in Cogitex (reuse of email = fresh password set), so there is exactly one account and one password for the whole suite.

## Deploy to Vercel (two projects from this one repo)

Create **two** Vercel projects pointing at this repo — set a different **Root Directory** for each:

1. **VIDE CORTEX** → Root Directory: `vide-cortex`
2. **Cogitex** → Root Directory: `cogitex`

### Environment variables (Vercel → Settings → Environment Variables)

**Both projects** (same values):

```
AUTH_SECRET=<same shared secret in both apps>
NEXT_PUBLIC_SUITE_COAPP_URL=<cogitex Vercel URL>
```

Generate the secret:
```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Cogitex only:**
```
DATABASE_URL=<Neon Postgres pooled connection string>   # free at neon.tech
COGITEX_PUBLIC_URL=<cogitex Vercel URL>
VIDE_LOGIN_URL=<vide Vercel URL>/login
VIDE_SSO_ALLOWED_HOSTS=<vide Vercel host>,<cogitex Vercel host>
LLM_PROVIDER=openrouter
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=<OpenRouter key>
LLM_MODEL=<model id>
```

**VIDE only:**
```
COGITEX_VERIFY_URL=<cogitex Vercel URL>/api/auth/suite-verify
COGITEX_PROVISION_URL=<cogitex Vercel URL>/api/auth/suite-provision
NEXT_PUBLIC_USE_MOCKS=true          # demo fleet without a backend; flip off for live telemetry
```

(Browse each folder's `.env.example` for every supported name — the suite rows are appended there too.)

### Deploy order matters
Deploy **Cogitex FIRST** (copy its Vercel URL), then VIDE (so the URLs above point at real addresses), then paste the Vercel URLs into Cogitex's env vars and redeploy once.

## Local development

```
# per app: copy .env.example -> .env.local, fill values
cd cogitex   && npm install && npm run dev   # :3030 — dev fallback DB is local-only PGlite
cd vide-cortex && npm install && npm run dev # :3000
```

Local dev needs both `.env.local` files to share the same `AUTH_SECRET` for the SSO chain; see each app's `.env.example`.
