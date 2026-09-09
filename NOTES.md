# Project Notes — running log

Append-only log of decisions and state that isn't obvious from the code or git
history. Newest entries at the top. Read this before starting work; add to it
when you make a call that a future session would otherwise have to re-derive.

---

## 2026-09-07 (later still) — Multiple plans; monthly calendar

**Diet and Split became collections.** `diet_plan` is now
`{ plans: [...], activeId }` and `split_plan` is `{ programmes: [...], activeId }`.
Selecting a plan to look at and marking one *active* are deliberately separate —
you can draft next month's split without switching off the one you're running.

The normalizers migrate the older single-plan shape into a one-item collection on
read, so no data migration was needed and no SQL changed. Neither database had
real plan rows yet, but the path is there anyway.

Two things that will bite if these editors are touched again:

- **The number inputs hold their own text** (`NumCell`) so half-typed values like
  `12.` survive a keystroke. That means the editors *must* be keyed by plan id —
  `<DietPlanEditor key={plan.id}>`, `<ProgrammeEditor key={prog.id}>` — or
  switching plans leaves the previous plan's figures on screen. This was a real
  bug, caught before shipping.
- **Duplicating regenerates every nested id** (`cloneDietPlan`, `cloneProgramme`).
  A shallow copy would share meal/exercise keys, and editing the copy would edit
  the original.

Carbs and fat are per-plan opt-outs (`showCarbs`, `showFat`), defaulting to on so
nothing already entered disappears. When off they vanish from the targets, the
food rows and the meal subtotals. Calories and protein are always shown. Nothing
was ever *required* — blank has always stored as null.

Split gained a bulk "set every exercise to N × M" action, scoped to the selected
programme. Leaving one box empty changes only the other.

The calendar now defaults to a **monthly** view (four or five boxes — the whole
screen on a phone) with a Yearly toggle for looking back. Month navigation rolls
over the year boundary. Weeks are filed by the month their *Monday* falls in,
which is the same rule the year view already grouped by.

---

## 2026-09-07 (later) — Renamed to Health Tracker; diet plan + gym split added

Same feature, wider scope. Four tabs now: Calendar, Progress, Diet, Split.

**The view id is still `lift_tracker`, and so are the API paths (`/api/lift-log/*`)
and the tables (`lift_entries`, `lift_settings`).** Only the labels changed. The id
is written into saved nav state in localStorage *and* into every account's
`allowed_views`, so renaming it would silently revoke access. Not worth it.
`LiftTracker.tsx` → `HealthTracker.tsx` was the one rename made, since nothing
outside the import points at it.

Diet and split are documents on the user's existing `lift_settings` row
(`diet_plan`, `split_plan`, both jsonb). They describe *intent*, not history —
one standing plan you edit in place — so they are deliberately not versioned per
week the way the log is. If per-week plan history is ever wanted, that is a new
table, not a change to these columns.

Both editors autosave, debounced ~700ms, and the settings PATCH stores them as
sent rather than validating field by field (guarded only on shape and a 200KB
cap). The tool owns both ends of that shape; `normalizeDiet` / `normalizeSplit`
on the read side tolerate the empty `{}` every existing row starts as.

The JSON export now carries both plans; the CSV is still the weekly log alone,
since a diet and a split don't flatten into the same table.

Migration: re-run `node scripts/migrate-lift-and-access.mjs <v1|v2>` — the third
statement was appended to the same script, and all of it is safe to re-run. V2
done 2026-09-07.

---

## 2026-09-07 — Lifting Tracker + per-user feature access

Two additions, both additive to the schema.

### Lifting Tracker (Tools > Lifting Tracker, since renamed Health Tracker)

A software version of the "Lean Bulk Tracker" Google Sheet. One row per week,
keyed to that week's **Monday** — `lift_entries (user_id, week_start)` is unique,
so saving a week overwrites it rather than stacking duplicates. The calendar is
the input surface; the Progress tab reads back out of the same rows.

Exercises are per-user and editable (`lift_settings.exercises`, a jsonb array),
not hard-coded columns, so a second person can track different lifts. Loads and
reps live in `lift_entries.lifts` keyed by exercise **name** — renaming an
exercise therefore starts its history fresh, which is called out in the settings
UI. Units are labels only; changing kg→lb does not convert stored numbers.

Charts are hand-rolled SVG. There is no charting library in this project and one
line of data did not justify adding one.

**Sharing:** `lift_settings.share_token` powers `/api/lift-log/export?token=…`,
which returns the whole log as CSV (`&format=json` for JSON). It is in
`BYPASS_ROUTES` — the token *is* the credential — so it can be pasted into a
Claude project, or into a Sheet via `IMPORTDATA`. Off by default; turning it off
nulls the token and permanently breaks the old link.

### Per-user feature access

`profiles.allowed_views text[]` is the source of truth, **mirrored into the auth
user's `app_metadata`** on every write (`mirrorToAuth` in `/api/users`). The
middleware gates off that mirror, so enforcement costs no database round-trip on
the hot path.

`null` means *unrestricted*, and the column is left NULL by the migration. That
is deliberate: every account that predates this feature keeps exactly the access
it had, and V1 cannot be narrowed by deploying. Access only ever shrinks when an
admin ticks boxes in Settings > Users. Admins are never restricted.

Gating is in two layers — the nav hides what you can't open (`/api/me`), and the
middleware 403s the matching API prefixes (`API_GATES` in
`src/lib/feature-access.ts`). Adding a new gated view means adding it in both
places, i.e. one entry in `FEATURES` and one in `API_GATES`.

`/api/users` now **requires `is_admin`** — previously any signed-in user could
create an admin account. Checked before shipping: V1 and V2 each have exactly one
profile and it is an admin, so nobody was locked out.

Tools were already user-scoped (`tasks.user_id`), so "their own clean copy" needed
no new work beyond the tracker following the same pattern.

### Migration

`node scripts/migrate-lift-and-access.mjs <v1|v2>` — run once per environment.
V2 was migrated on 2026-09-07. **V1 must be migrated before the code deploys**,
or User Management breaks on V1 (its query selects `allowed_views`).

---

## 2026-09-09 — All Make scenarios rerouted to app.tomsimedia.com (outage fix)

- **All funnel ingestion was down from the evening of 8 Sept.** 15 Make
  scenarios (client dials/leads/appointments/shows/no-shows/callbacks and all
  six B2B funnel ones) posted to `daring-creation-production.up.railway.app`,
  which no longer exists ("Application not found"). Make still reported every
  run as successful, so nothing looked wrong. 36 client runs (30 dials, 4
  appointments, 2 leads) on 9 Sept went to the dead address and are lost — the
  Make API has no replay endpoint; replay is UI-only.
- **Every scenario with a webhook URL — 27 in total — now calls
  `app.tomsimedia.com`.** Done via the Make API (blueprint PATCH). Make
  rate-limits at roughly 15 scenario edits a minute.
- One casualty of the bulk host swap: `CCM - Sales Call Territory Scoring`
  has a second HTTP call to GHL (`services.leadconnectorhq.com/contacts/…`)
  that was overwritten too; restored from blueprint version history.
- **The six B2B funnel scenarios had never worked.** Their HTTP module lacked
  `followRedirect` and `rejectUnauthorized` — Make's "Validation failed for 2
  parameter(s)" — so any real event errored and Make auto-disabled the scenario.
  Rebuilt the modules on the working All Dials structure. Do NOT copy the
  client module's filter ("Has call start time") into B2B: it silently skips
  every B2B event (run succeeds with 1 op, nothing sent).
- Three real B2B events (intro booked / intro shown / sales call booked, 9 Sept
  ~16:12–17:37 UTC) were consumed by the broken runs; they can be re-sent by
  replaying those runs in the Make UI.
- Third B2B fault: `b2b_events` had no unique index on `external_id`, so the
  webhook's upsert-on-appointment-id failed with Postgres 42P10 on every real
  event (Make still green). Added `b2b_events_external_id_key` on V1 directly;
  also in `schema.sql`, `migrations/add_b2b_external_id_unique.sql`, `migrate.mjs`.
- B2B timestamps were rendered in Make's org timezone with no offset
  (`formatDate(now; "YYYY-MM-DDTHH:mm:ss")`) and stored 4h early. All seven B2B
  templates now use `...ssZ`, matching the client scenarios. The one real row
  affected (lead, 9 Sept) was corrected by hand.
- Empty GHL ids (`customData.lead_id` / `appointment_id` absent) arrived as `""`
  and collided on the unique `external_id` from the second event on. Both
  webhooks now store `""` as NULL. The old partial index
  `b2b_events_external_id_unique` was dropped; `b2b_events_external_id_key`
  (plain unique) is the one that serves ON CONFLICT.
- `CCM - B2B New Lead` never received anything from GHL at all — the GHL
  new-lead workflow for the B2B account is not pointing at its Make webhook.

## 2026-09-09 — V1 moved to app.tomsimedia.com (old address kept)

- **V1 is now `app.tomsimedia.com`.** `dashboard.tomsimedia.com` still points at
  the same Railway service and must stay that way — client report links already
  sent out live on the old address and cannot be edited once they're out.
- Reason for the move: `dashboard` vs `dashboards` was one character apart from
  the V2 demo, which made it easy to hit the wrong environment.
- Both domains hold valid certificates on the `dashboard v1` Railway service.
- Updated to the new address: the hard-coded URL in `admin/run-b2b-migration`,
  and the `ccm-attribution-refresh` + `ccm-b2b-meta-spend` blueprints. **The
  live Make scenarios were not touched** — they still call the old address,
  which is fine while it stays alive, and they only change on re-import.

### If a custom domain sits on "Waiting for DNS update"

Railway can hang at `CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP` with DNS
already correct and propagated. It stayed stuck for a day. **Deleting the domain
in Railway and adding it straight back** fixed it in minutes. The plan's custom
domain limit greys out the Custom Domain button but does not block a domain
that's already in the list — deleting one frees the slot to re-add it.

Railway's API gives the real status (the UI only says "waiting"):
`domains(projectId, environmentId, serviceId){ customDomains{ domain status{ certificateStatus dnsRecords{...} } } }`
on `backboard.railway.com/graphql/v2`.

---

## 2026-09-02 — Sales-call territory scoring (built, never wired up)

What it is: when a B2B sales call is booked in GHL, the prospect's targeting
info is turned into a scored Zip Tool territory session automatically, and the
worst-performing zip is written back onto the GHL contact for the sales team to
use on the call.

- Flow: GHL workflow → Make scenario **"CCM - Sales Call Territory Scoring"**
  (`make-blueprints/ccm-sales-call-territory.blueprint.json`) → `POST
  /api/admin/onboard` → back to GHL.
- Reads these contact custom fields: `targeting_radius` (miles, clamped 5–75,
  defaults to 35), plus **one** of `postal_code` / `zip_code_targeted` (one or
  two zips) / `zip_code_list` (explicit multi-line list). Writes the result to
  `worst_performing_zip_code`.
- Creates a row in `client_sessions` with **`client_id = null` on purpose.**
  These are prospects, not clients — the session stays unattached until someone
  links it to a client. Do not "fix" this.
- Session name is the prospect's **company** name, falling back to the person's
  name, then `Unknown` (changed 2026-09-02; Make now also sends
  `company_name` from `contact.companyName`).

### Status: dormant — nothing has ever run through it

- The blueprint ships with `REPLACE_WITH_YOUR_RAILWAY_URL` as the endpoint. It
  was never pointed at V1 or V2.
- Confirmed against both databases on 2026-09-02: **zero** sessions from this
  flow in either. V1 has no `client_sessions` rows at all; V2's 17 are all
  seeded and attached to clients.
- So it isn't a V1 or a V2 feature — it's environment-agnostic code waiting on
  someone to fill in the Make URL. Whichever URL goes in decides the
  environment.

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
- **V1** = app.tomsimedia.com (real data, Supabase `fsebiwzgjenjwiyujexl`).
  dashboard.tomsimedia.com is the old V1 address and still works — keep it.
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

---

## 2026-09-04 — Keeping attribution current

The one-off backfill does not keep up: new *contacts* arrive with no attribution,
and their whole downstream funnel inherits the blank. Coverage was visibly
decaying — 74% on 09-02, 41% on 09-03, 0% on 09-04 — before a catch-up run.

(Existing contacts are fine: `/api/webhooks` already inherits attribution onto
later events, so only genuinely new contacts are the gap.)

**Verified: `/api/admin/backfill-ghl-attribution` works against live V1 from the
public internet** with the admin bearer secret. A catch-up run took V1 to **1,156
of 1,285 (90%)**, with today's leads at 100%. That proves the scheduled call.

### Scheduling — blocked on a Make permission

`MAKE_API_KEY` cannot create scenarios:
`403 Insufficient rights, team permission "Create scenarios" is needed.`
(Consistent with [[make-api-gotchas]] — the key is scoped narrowly.)

So `make-blueprints/ccm-attribution-refresh.blueprint.json` is written for manual
import: a single scheduled HTTP POST, hourly, body
`{"dry_run": false, "only_missing": true, "limit": 500}`. The Authorization
header is a `REPLACE_WITH_ADMIN_WEBHOOK_SECRET` placeholder — the real secret is
never committed.

`only_missing` makes each run cheap: it skips everything already attributed, so a
run costs one GHL call per genuinely new contact.

### The alternative, if Make is not wanted

Enrich inside `/api/webhooks` on ingest — instant instead of hourly, and no
external scheduler. Deliberately not built: that route is live production
ingestion for real clients, and per the V1 rule it needs explicit approval rather
than my judgement. It would have to be strictly fire-and-forget so a GHL timeout
can never block or fail an event insert.

