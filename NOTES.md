# Project Notes — running log

Append-only log of decisions and state that isn't obvious from the code or git
history. Newest entries at the top. Read this before starting work; add to it
when you make a call that a future session would otherwise have to re-derive.

---

## 2026-08-31 — Communication rules (read before replying)

- The user is **not a coder**. Never explain code, file paths, function names or
  implementation detail — it's noise to them.
- Don't narrate work in progress. Do it, then summarise the outcome.
- Report only: what changed (in plain language), what's still broken or missing,
  what needs them, and any number that will visibly move.
- Fewest words possible. No preamble, no recap of their request.
- Full rule at the top of `CLAUDE.md`.

## 2026-08-29 — V1 outranks V2, always

- Stated explicitly by the user: **V1 (`dashboard.tomsimedia.com`, real client
  data) is the priority by a wide margin.** V2 is a demo on synthetic data.
- Rule: never make a change for V2 that could negatively affect V1. If a change
  helps V2 and carries any risk to V1, **warn first and let the user decide** —
  do not execute on your own judgement.
- The trap this guards against: both environments deploy from `main`, so there
  is no such thing as a "V2-only" code change. Anything pushed for V2 lands on
  production the same minute.
- Databases are the exception to "everything is shared" — V1 and V2 are separate
  Supabase projects. Migrations are NOT applied by deploying: the build is plain
  `next build`, and the `.sql` files in the repo never execute. Each database has
  to be migrated explicitly, V1 with production-grade care.
- Recorded at the top of `CLAUDE.md` so it loads into every session.

---

## 2026-08-29 — Dropped the standalone zip-tool prototype

- Briefly moved the standalone `zip-market-tool` (`~/Downloads/zip-tool`) into
  `tools/zip-tool/`, then removed it — both folders sent to Trash.
- Reason: its scoring logic was already ported into the dashboard and extended
  there. `tools/zip-tool/src/lib/score.ts` (133 lines) is the direct ancestor of
  `src/lib/zip-score.ts` (242 lines); same for `lookup`→`zip-lookup`,
  `neighborhoods`→`zip-neighborhoods`, `ZipMap.tsx`.
- The live, wired-up zip features are in the dashboard: `src/app/api/zip-*`,
  `src/components/ZipTool.tsx` + `ZipMap.tsx`, `src/lib/zip-score.ts`,
  `src/lib/census.ts`. There is no separate zip app anymore.

## Context / setup

- **Repo:** `github.com/gzaballap-stack/dashboardsrepo`, branch `main`.
- **Deploy:** push to `main` → Railway auto-deploys both V1 and V2. No preview envs.
- **V1** = dashboard.tomsimedia.com (real data, Supabase `fsebiwzgjenjwiyujexl`).
  **V2** = dashboards.tomsimedia.com (demo/mock data, Supabase `raboufpmctaeqgbrxppy`).
- **Session roles:** this (code) session changes code and pushes. A separate
  "V2 data" session owns V2 mock-data seeding/backfills via
  `POST dashboards.tomsimedia.com/api/cron/seed-daily`. Keep them separate.

## AI Campaign Chat

- Endpoint `src/app/api/ai-campaign-chat/route.ts` is built and wired into the
  Campaign Detail Drawer. Model: `claude-haiku-4-5`, called server-side.
- Blocked only on `ANTHROPIC_API_KEY` — needs an Anthropic Console account
  (console.anthropic.com), key added to `.env.local` locally and to Railway env
  vars for **both** V1 and V2. Usage-billed, no monthly fee.
- The route builds `context` from the client/campaign's own data; the model has
  no direct DB access and no API key is exposed to the browser.

## Recent direction (from git history)

- Make.com pipeline being consolidated: multi-module blueprints → single call to
  `*/sync-all` endpoints (`ad-spend/sync-all`, `b2b-ad-spend/sync-all`).
- B2B ad pipeline added down to ad-set / ad level.
- CSM Dashboard added (touchpoints, upsell/review tracking, at-risk detection).
- CARTO API key supported for basemap tiles.
- Synthetic `ad_campaigns` generated for V2 demo clients.
