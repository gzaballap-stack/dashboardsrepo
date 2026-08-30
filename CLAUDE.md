# Call Center Reporting Dashboard

> ## ⚠️ V1 is the priority — always
>
> **V1 (`dashboard.tomsimedia.com`) is production, with real client data. It
> outranks V2 in every decision.** V2 is a demo environment running synthetic
> data; it is never worth degrading V1 for.
>
> - **Never make a change for V2's benefit that could harm V1** — not its data,
>   its numbers, its uptime, or its behaviour.
> - If a change helps V2 and carries *any* risk to V1, **stop and warn the user
>   before executing.** Explain the risk and let them decide. Do not proceed on
>   your own judgement.
> - When a trade-off between the two is unavoidable, V1 wins by default.
> - Both environments run the same code, so *any* push affects V1. A change
>   framed as "just for V2" still ships to production — treat it as a V1 change.
>
> See "Two environments" below for what is and isn't shared between them.

## ⚠️ Be concise

The user wants **conclusions, not commentary**. Report only what changes a
decision they have to make.

- No narration of work in progress. Don't describe what you're about to do, what
  you're checking, or what you just ran. Do the work, report the outcome.
- No step-by-step accounts of investigation, tool calls, or reasoning.
- Lead with the answer. Detail only if it's load-bearing.
- Say what's broken, what's fixed, what's still empty, and what needs the user.
- Keep caveats — they're relevant. Cut the process around them.
- Short paragraphs or tight bullets. No recap of things already said.

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

**V1 is the priority environment — see the warning at the top of this file.**

Both run the **same code** off the `main` branch. Railway's GitHub integration
auto-deploys both on every push — there is no separate release step. This is why
a "V2-only" code change does not exist: every push lands on V1 too.

What is *not* shared: the two Supabase databases are entirely separate. Schema
changes are **not** applied by deploying — the `.sql` files in this repo are
inert text, and the build runs only `next build`. Each database must be migrated
explicitly, and V1 should be treated with the caution production deserves.

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

Work requested for V2 still has to clear the V1 bar. If a V2 request would mean
changing shared code, shared schema shape, or anything V1 reads, raise it before
acting — see the priority warning at the top.

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

## Ad attribution & call recordings (GHL → Make → webhooks)

`ad_campaigns` records what each campaign/ad set/ad **spent**; `events` and
`b2b_events` record what the funnel **produced**. The join between them is the
attribution block below, sent by GHL through Make.

The webhooks accept every field already — anything absent is stored as `null`,
so partial coverage is fine and nothing breaks while GHL is only half wired.

**Set these as custom data on the GHL workflow** (names must match exactly; the
Make blueprints read `1.customData.\`<Name>\``):

| GHL custom data field | Webhook key | Notes |
|---|---|---|
| `Ad Platform` | `ad_platform` | meta / google / tiktok |
| `Campaign ID` · `Campaign Name` | `campaign_id` · `campaign_name` | joins to `ad_campaigns.campaign_id` |
| `Ad Set ID` · `Ad Set Name` | `adset_id` · `adset_name` | |
| `Ad ID` · `Ad Name` | `ad_id` · `ad_name` | |
| `UTM Source` · `UTM Medium` · `UTM Campaign` · `UTM Content` · `UTM Term` | `utm_*` | GHL fills these far more reliably than the numeric IDs — keep both |
| `Referrer URL` | `referrer_url` | |
| `Call Status` · `Agent Name` · `Call Summary` | `call_status` · `agent_name` · `call_summary` | dial events |

> **Call recordings are parked.** Getting a per-call recording URL out of GHL
> proved impractical, so `Call Recording URL` was removed from the dial
> blueprint. Whether a call happened, its duration, status and agent are still
> tracked. The recording plumbing (`events.recording_url`, `/api/recordings`,
> the drawer's Recordings tab, the CSM recordings view) is built and dormant —
> it will populate if a URL ever becomes available, and shows empty states
> until then. Don't invest further here without new information.

### Attribution only needs to be on the New Lead workflow

`/api/webhooks` inherits attribution automatically (`src/lib/attribution.ts`).
When an event arrives without attribution of its own, it copies it from that
contact's **earliest attributed event**, matched on `ghl_contact_id`.

This matters because of how Meta lead forms work: Meta attaches
`ad_id`/`adset_id`/`campaign_id` to the lead submission, but the appointment
booked three days later carries nothing. Without inheritance, spend could only
ever be tied to leads — never to appointments, closes or revenue.

So in practice:

- **Required:** attribution custom data on the **New Lead** workflow.
- **Optional:** the same fields on dial / appointment / show / no-show /
  callback. An event that carries its own attribution always wins over the
  inherited value; adding them is a refinement, not a prerequisite.

That reduces the GHL rollout from six workflows per location to one.

> `closed` is now an accepted `event_type` on `/api/webhooks` and carries
> `revenue`. Until GHL sends real closes, the only ones in the database are
> synthetic rows generated by `admin/backfill-closes` from shows — do not read
> them as real revenue.

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
