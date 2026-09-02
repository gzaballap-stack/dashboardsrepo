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

---

## 2026-08-31 — GHL already had the ad attribution all along

**The whole B2C attribution problem was solved by reading GHL instead of
reconfiguring it.** GoHighLevel stores campaign/ad-set/ad IDs on the *contact*,
including for Meta Instant Form leads that never touch a landing page. No pixel,
no Meta App Review, no CAPI, no workflow custom-data, no Make changes.

Verified against V1 production: **307 of 310 contacts carry full attribution**;
the 3 misses are contacts deleted in GHL. Dry run says **1,156 of 1,159 events
would be attributed** — i.e. essentially all of V1's history, retroactively.

Sample of what GHL returns per contact (`attributionSource`):

```
campaignId  120246290176920347   campaign   Tomsi Media | Qualified Estimates | 05/13/26
adSetId     120251389263680347   utmMedium  Chattanooga 50 Miles (Radius) | Feeds, Stories, Reels
adId        120251389263650347   utmContent Bathroom Script 12
```

### Access

- `GHL_API_KEY` in `.env.local` — a **sub-account** Private Integration token
  (`pit-…`) with `contacts.readonly`.
- **Agency-level** private integrations do *not* offer contact scopes; only
  company scopes (companies/locations/SaaS/snapshots/users/…). A token made
  there returns 401 `not authorized for this scope` on everything except
  `/locations/{id}`. Create the integration *inside* a sub-account.
- The legacy per-sub-account API key (Settings → Business Info, a JWT) still
  reads contacts on API **v1** (`rest.gohighlevel.com/v1`) but is being gated
  behind a paid plan. Private Integrations are the supported path.
- One token turned out to read contacts across all nine dashboard clients.

### Built

- `src/lib/ghl-attribution.ts` — `fetchGhlAttribution()` + `mapGhlAttribution()`.
  Field spelling varies by sub-account (`utmCampaign` vs `utm_campaign`), so
  every read goes through a multi-name `pick()`. Retries 429 with exponential
  backoff and honours `Retry-After`.
- `src/app/api/admin/backfill-ghl-attribution/route.ts` — `POST` with
  `{ dry_run, table, limit, only_missing }`. **`dry_run` defaults to true**;
  nothing writes unless explicitly `false`. One lookup per *contact*, not per
  event (1,159 events → 310 calls). Added to `BYPASS_ROUTES`.

### Gotchas

- GHL 429s readily. Concurrency 3 + a 200 ms pause between batches + backoff took
  failures from 37 → 0 (rate-limit ones).
- `adset_name` / `ad_name` come from `utmMedium` / `utmContent`, which is this
  portfolio's ad-naming convention, not a dedicated GHL field. **The IDs are
  reliable; the names are best-effort.**
- Uses `attributionSource` (first touch), matching the first-touch model
  `lib/attribution` already applies downstream.

### Still open

- Backfill has **not been run against V1** — dry run only, awaiting the go-ahead.
- New events still arrive unattributed. Preferred fix is scheduling this route
  with `only_missing: true` rather than touching `/api/webhooks`, which is live
  production ingestion.
- Two credentials were exposed in chat during this work (a v1 JWT and a
  `pit-` token) — both should be rotated.

---

## 2026-08-31 — Creative leaderboard + attribution health

Two additions beyond parity with Hyros.

### 1. Cross-client creative leaderboard (`/api/creative-leaderboard`, nav: Overview)

The same creative runs for many clients under different ad IDs. Verified in V1:
**907 ad-level spend rows, 44 distinct creatives, 11 of them running for more
than one client** — "Bathroom Script 12" runs for 4 clients under 6 ad IDs.

Per-account tools (Hyros included) can only score each copy separately, splitting
one creative's record across several thin samples. Grouping by creative *name*
across the portfolio pools them, so a creative is judged on all the appointments
it produced rather than the handful under one client this month. This is a
structural advantage of being the agency, and is not something a single-account
tracker can reproduce.

- Levels: creative / ad set / campaign.
- Sorted by cost per appointment; entities with zero appointments sort last by
  spend descending, so expensive silent creatives surface immediately.
- `normaliseName()` folds "– Copy", "(copy 2)", case and whitespace drift.
- Spend rows are per-day, so each entity's funnel is folded in exactly once
  (`seenEntity`) — otherwise a 30-day creative would count its funnel 30 times.

**Known limit:** "Bathroom Script 12" and "Script 12 Bathroom" are almost
certainly the same creative but will not pool — matching is exact after
normalisation. Fuzzy matching was deliberately not attempted; wrongly merging two
creatives is worse than leaving them apart.

### 2. Attribution health monitor (`/api/attribution-health`)

Attribution stopped arriving for months with no error anywhere — spend showed,
leads showed, and the join between them silently returned nothing. Nothing in the
dashboard could have surfaced that.

This measures the share of events carrying ad data, per client, and compares the
last 7 days against the prior window. Flags a client when coverage falls ≥25pp
(both windows need ≥5 events, to avoid noise) or sits below 50%.

Rendered as a banner at the top of the leaderboard rather than a separate page —
the table is only as complete as its inputs, so coverage is stated where the
numbers are read, not somewhere you would have to go looking.

### Deliberately not built

- **First/last-touch toggle.** GHL returns `lastAttributionSource` alongside
  `attributionSource` for free, so multi-touch is cheap *except* that storing it
  needs new columns on V1 `events` — a production migration. Worth doing; wanted
  explicit approval first.
- **Call tracking / dynamic number insertion.** Call data already arrives from
  GHL; DNI would duplicate it.
- **Conversions API.** Already built separately by the user.

---

## 2026-08-31 — Order-insensitive creative pooling + first/last touch toggle

### Creative pooling now ignores word order

`poolKey()` in `creative-leaderboard` lowercases, strips punctuation, sorts the
tokens and rejoins — so "Bathroom Script 12" and "Script 12 Bathroom" collapse to
`12 bathroom script`. Still exact on the words themselves, so "Bathroom Script 10"
and "Bathroom Script 12" stay apart.

Verified against V1: **44 groups → 40, four merges, all genuine.**

| merged | clients | spend |
|---|---|---|
| Bathroom Script 12 + Script 12 Bathroom | 6 | $3,479 |
| Kitchen Script 12 + Script 12 Kitchen | 4 | $1,635 |
| Us VS Them Clipboard/Kitchen (both orders) | 4 | $178 |
| Us VS Them Clipboard/Bathroom (both orders) | 3 | $121 |

Every pooled spelling is returned on the row as `pooled_names` and shown under
the creative name in the UI, so an unintended merge is caught by eye rather than
trusted. Display name is the highest-spend spelling.

> A fuller creative/copy hub is planned; this is the leaderboard-only version.

### First / last touch toggle

GHL returns `lastAttributionSource` on the same call as `attributionSource`, so
last touch costs nothing extra to capture.

- **Migration:** `supabase/migrations/add_last_touch_attribution.sql` adds a
  single `last_touch jsonb` column to `events` and `b2b_events`, plus partial
  expression indexes on the ad/adset/campaign ids. One json column rather than 13
  more columns — the reporting routes aggregate in application code, so separate
  columns buy nothing.
- `rollupFunnelByAd()` takes `model: 'first' | 'last'`. First touch reads the
  attribution columns; last touch reads `last_touch->>{id}`. Default stays
  `first` everywhere.
- `?model=` supported on `/api/creative-leaderboard` and
  `/api/client-ad-breakdown`; UI toggle on the leaderboard.
- The backfill writes `last_touch` alongside the first-touch columns.

First touch credits the ad that created the lead, last touch credits the ad seen
most recently before converting. They routinely disagree and neither is more
correct — hence a toggle rather than a chosen default.

### Two production actions still outstanding

1. **Run `add_last_touch_attribution.sql` on V1** (and V2). Purely additive —
   `add column if not exists` + `create index if not exists`. Until it runs, the
   Last Touch toggle returns empty.
2. **Run the backfill.** Still dry-run only.

Order matters: migration first, then backfill, or last touch is discarded.

