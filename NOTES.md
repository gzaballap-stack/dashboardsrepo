# Project Notes — running log

Append-only log of decisions and state that isn't obvious from the code or git
history. Newest entries at the top. Read this before starting work; add to it
when you make a call that a future session would otherwise have to re-derive.

---

## 2026-08-31 — Communication rules (read before replying)

- **Use as few words as possible.** This is the top rule — brevity outranks
  completeness.
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

---

## 2026-08-31 — Ad attribution: measured the gap, built the ad-level funnel join

**Finding: attribution is a data gap, not a reporting gap.** Measured V1 directly:
**0 of 1,020 `events` carry any attribution** — no `campaign_id`, `adset_id`,
`ad_id` or UTMs. Same for all 37 `b2b_events`. Meanwhile `ad_campaigns` is fully
populated (532 campaign / 354 adset / 875 ad rows). Full spend, zero funnel
linkage — the join key is empty on every row. V2 is the same: 125,423 events,
none attributed.

The ingestion code was never the problem. `pickAttribution` /
`inheritAttribution` work and both webhooks call them; nothing feeds them.

**Root cause: the live Make scenarios are older than the repo blueprints.** Live
`lead` payloads carry 7 keys (`client_name, event_type, ghl_contact_id,
lead_email, lead_name, lead_phone, occurred_at`) — three of which the repo
blueprint doesn't even send. Different scenario, not a partially-filled one. The
blueprints still have the literal `REPLACE_WITH_YOUR_RAILWAY_URL` placeholder;
they were written and never imported.

Two gaps in series, neither of them code:
1. **Make** — import the updated blueprints, set the real Railway URL.
2. **GHL** — the workflows must populate the custom data fields the blueprints
   read (`Ad Platform`, `Campaign ID`, …). Importing without this yields keys
   with empty values. Only the **New Lead** workflow strictly needs them —
   inheritance covers the rest.

**Blueprint regression caught and fixed.** Every event blueprint was missing
`lead_name` / `lead_email` / `lead_phone`, and the appointment ones were missing
`external_id` (which `/api/webhooks` upserts on, and which the booked→show flip
depends on). Importing them as-is would have *removed* fields V1 currently
receives. Added, mapped to `1.full_name` / `1.email` / `1.phone` /
`1.calendar.id`. **These GHL field names are inferred from the LeadConnector Make
app, not verified against the live scenario — check them in Make before
importing.**

The `REPLACE_WITH_YOUR_RAILWAY_URL` placeholder was deliberately left alone:
hardcoding V1's URL would mean an accidental V2 import pipes demo data into
production.

**Built: ad-level funnel rollup.** `src/lib/ad-funnel.ts` — `rollupFunnelByAd()`
groups real CRM events by `campaign_id`/`adset_id`/`ad_id` and returns
leads/appts/shows/no_shows/closes/revenue; `funnelRates()` derives cost-per-stage
and ROAS. Wired into `client-ad-breakdown` (B2C), `b2b-adsets` and `b2b-ads`
(B2B). The drawer's Ad Sets / Ads tables gained Leads, Appts, Shows, Closes,
Cost/Lead, Cost/Appt, ROAS.

- Meta's `ad_campaigns.leads` is kept separate and relabelled **"Meta Results"** —
  it counts what Meta saw, not what reached the CRM. They rarely agree.
- B2B maps `intro_booked`→appts, `intro_shown`→shows, `close`→closes.
  `sales_call_*` are downstream of the intro and are deliberately not folded in,
  to avoid double-counting one contact.
- Events with a null id at the requested level are skipped, never spread — that
  would invent attribution that isn't there.
- The join degrades to a zeroed funnel if it throws, so the spend table still
  renders. V2 currently has no `b2b_events` table at all, which would otherwise
  have 500'd both B2B routes.

**Everything renders zeros until the Make/GHL side is wired.** That is expected,
and is the point of doing it now: the moment attribution flows, it shows up.

**Also found:** V1 has no `show`, `no_show` or `closed` events at all — only
`lead` (248), `dial` (623), `appointment_booked` (142). So "which ads drive
closes" has a second blocker independent of attribution. B2B does have `close`.
