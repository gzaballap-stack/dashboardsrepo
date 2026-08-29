# Call Center Reporting Dashboard

## What This Is

A reporting dashboard for a call center / setter team. Tracks dials, leads,
appointments, shows, no-shows, ad spend, CSM health, and zip-level performance
across all lead sources.

**Data pipeline:** GHL → Make.com → Railway (this app) → Supabase → Dashboard

**Stack:** Next.js 16 (App Router) · React 19 · Tailwind 4 · Supabase (Postgres + SSR auth) · deployed on Railway.

> ⚠️ See `AGENTS.md` — this Next.js version has breaking changes vs. common
> training data. Check `node_modules/next/dist/docs/` before writing framework code.

---

## Two environments (V1 and V2)

Both run the **same code** off the `main` branch. Railway's GitHub integration
auto-deploys both on every push — there is no separate release step.

| | V1 (production) | V2 (demo) |
|---|---|---|
| URL | dashboard.tomsimedia.com | dashboards.tomsimedia.com |
| Supabase ref | `fsebiwzgjenjwiyujexl` | `raboufpmctaeqgbrxppy` |
| Data | real client data | synthetic / seeded mock data |
| Env file | `.env.v1` | `.env.v2` |

Switch which one you point at locally:
```bash
npm run use:v1   # or use:v2  — rewrites .env.local from .env.vN
npm run dev:v1   # switch + start dev server
```
`scripts/switch-env.js` only swaps the Supabase URL + keys in `.env.local`; the
other vars stay put.

**Division of work across chat sessions:**
- **Code sessions (this repo):** make code changes, `git push` → deploys to V1 + V2.
- **V2 data session (separate chat):** manages V2's mock data — seeding via
  `POST https://dashboards.tomsimedia.com/api/cron/seed-daily`, backfills, demo
  client pipeline. If asked about V2 data seeding here, that work belongs in the
  V2 data session.

---

## Deploy

`git push origin main` → Railway builds & deploys V1 and V2 automatically.
No preview environments. Check Railway dashboard for build logs.

---

## Auth model

- Browser routes: Supabase SSR auth, enforced in `src/middleware.ts`.
- `BYPASS_ROUTES` in the middleware skip session auth — webhooks, admin, cron,
  setup, login, `/report`. Those authenticate themselves with an API key or
  `ADMIN_WEBHOOK_SECRET` (see `src/lib/api-auth.ts`).
- First-run admin account: visit `/setup`.

---

## Folder structure

```
/
├── CLAUDE.md                    ← this file
├── NOTES.md                     ← running log of decisions / current state — READ IT
├── AGENTS.md                    ← Next.js version warning
├── .env.local                   ← active env (gitignored) — swapped by use:v1 / use:v2
├── .env.v1 / .env.v2            ← per-environment Supabase creds
├── .claude/commands/start.md    ← /start first-time setup skill
│
├── make-blueprints/             ← Make.com scenario blueprints (import into Make)
├── supabase/
│   ├── schema.sql               ← full schema (source of truth)
│   ├── seed.sql
│   └── migrations/              ← incremental SQL applied on top of schema.sql
├── scripts/                     ← migrate.mjs, setup-db.mjs, switch-env.js
│
└── src/
    ├── middleware.ts            ← auth + route bypass list
    ├── app/
    │   ├── api/                 ← ~60 API routes (see "API route groups")
    │   ├── dashboard/           ← main dashboard page
    │   ├── report/[token]/      ← public shareable report
    │   ├── setup/ · login/
    ├── components/              ← one component per dashboard view
    └── lib/                     ← metrics.ts, census.ts, api-auth.ts, db-helpers.ts, …
```

---

## API route groups (`src/app/api/`)

| Group | Purpose |
|---|---|
| `webhooks/*` | Ingestion from Make (dials, leads, appts, status, claims, ad-campaigns, b2b) |
| `metrics`, `agent-stats`, `heatmap`, `report` | Core reporting reads |
| `ad-spend/*`, `b2b-ad-spend/*` | Ad spend sync — `sync-all` fetches + stores every ad level in one call |
| `campaign-overview`, `campaign-exclusions`, `client-ad-breakdown` | Campaign views |
| `csm-dashboard`, `client-csm-status`, `client-touchpoints`, `client-windows` | CSM health tracking |
| `zip-*` (`zip-lookup`, `zip-data`, `zip-radius`, `zip-neighborhoods`, `zip-performance`) | In-dashboard zip/territory features (uses `src/lib/census.ts` + `zip-score.ts`) |
| `ai-campaign-chat` | Claude-powered chat over a campaign/client's data — see below |
| `admin/*` | One-off ops: seeds, backfills, schema/migration runners (bypass auth via secret) |
| `cron/seed-daily` | V2 demo-data daily seed (driven by the V2 data session) |

---

## AI Campaign Chat

Already built: `src/app/api/ai-campaign-chat/route.ts`. `POST { context, messages }`
→ `{ reply }`. Calls the Anthropic API directly (model `claude-haiku-4-5`), server-side.

- The route pulls the relevant client/campaign data into `context` — the model
  never touches Supabase directly.
- Requires `ANTHROPIC_API_KEY` in the environment. **Currently unset** — the route
  returns a 503 with a "add the key" message until it's filled in `.env.local`
  (local) **and** Railway env vars (both V1 and V2).
- Get a key at console.anthropic.com (usage-billed, no monthly fee). Haiku is
  ~$1 / $5 per 1M input/output tokens.

---

## Zip / territory features

Fully in-dashboard — there is no separate zip app. API routes `src/app/api/zip-*`
(`zip-lookup`, `zip-data`, `zip-radius`, `zip-neighborhoods`, `zip-performance`),
UI in `src/components/ZipTool.tsx` + `ZipMap.tsx`, scoring in `src/lib/zip-score.ts`,
Census fetching in `src/lib/census.ts` (needs `CENSUS_API_KEY`).

> An old standalone `zip-market-tool` prototype existed under `~/Downloads/zip-tool`
> and was briefly copied into `tools/zip-tool/` on 2026-08-29, then removed — its
> logic had already been ported into `zip-score.ts` and extended. See `NOTES.md`.

---

## Environment variables (`.env.local`)

| Var | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase (swapped per env) |
| `SUPABASE_ACCESS_TOKEN` | Management API — used by schema/migration scripts |
| `ADMIN_WEBHOOK_SECRET` | Auth for webhook + admin routes |
| `MAKE_API_KEY` / `MAKE_TEAM_ID` / `MAKE_REGION` | Make.com API (blueprint updates, scenario listing) |
| `RAILWAY_TOKEN` | Railway API |
| `CENSUS_API_KEY` | Census data for zip features |
| `ANTHROPIC_API_KEY` | AI Campaign Chat (unset by default) |

Never commit `.env*` — they're gitignored. Production values live in Railway.

---

## Key files

| Task | File |
|------|------|
| First-run admin setup | `src/app/setup/page.tsx` (visit `/setup`) |
| Auth / route bypass list | `src/middleware.ts` |
| Webhook ingestion | `src/app/api/webhooks/route.ts` |
| Metrics calculation | `src/lib/metrics.ts` |
| Dashboard UI (nav + all views) | `src/components/DashboardView.tsx` |
| Database schema | `supabase/schema.sql` (+ `supabase/migrations/`) |
| Env switching | `scripts/switch-env.js` |
| First-time setup skill | `.claude/commands/start.md` (`/start`) |
