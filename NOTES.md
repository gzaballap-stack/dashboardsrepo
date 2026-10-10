## 2026-10-08 — Revenue-goal numbers on the Custom Area Breakdown doc

The sales-call doc gets a section with the prospect's own numbers: average
job, current revenue, revenue goal, and (derived) revenue gap, jobs needed,
qualified appointments needed. Everything derived is computed in
`src/lib/goal-math.ts` — never by hand on the call.

- **Inputs** are GHL contact custom fields `average_job`, `current_revenue`,
  `revenue_goal`, optional `close_rate` (defaults to 20%; "35", "35%" and
  "0.35" all work). Amounts accept `$1,250,000`, `1.2m`, `500k`.
- **Jobs needed** = ceil((goal − current) / average job);
  **appointments needed** = ceil(jobs / close rate).
- **Template tags:** `{{average_job}} {{current_revenue}} {{revenue_goal}}
  {{revenue_gap}} {{jobs_needed}} {{appointments_needed}} {{close_rate}}`.
- `/api/admin/onboard` now returns those tags inside `doc` too. If the numbers
  aren't on the contact yet, each value is the **tag itself** (`{{jobs_needed}}`)
  so the placeholder survives the first merge and can be replaced later.
- **New:** `POST /api/admin/sales-call-goals` (admin secret). Fired by a second
  GHL workflow when the revenue fields change. Returns the figures, a `doc_id`
  parsed from `doc_url` / `doc_id`, and `replacements` (`[{find, replace}]`)
  for Make's Google Docs "Replace a Text in a Document" module.
- The route reads whatever the payload lacks straight off the GHL contact
  (B2B token): the doc link is custom field `2iC8q2ndjpWgGd9uqKAl` (Custom Area
  Breakdown URL — the territory scenario already writes it), the three numbers
  are `OEFTmQgo…`/`gqnInqYl…`/`ZlYCAvDy…`. So Make only has to send
  `contact_id`.
- **Make scenario (live, built via API 2026-10-08):** "CCM - Sales Call Numbers
  (fill the doc)", id 7851284, webhook 3867886
  (`hook.eu1.make.com/v6ni7478jpk76rkzadsi6zbnhayu2ln8`). Webhook → HTTP POST
  sales-call-goals → Google Docs `replaceATextInADocument` with
  `document = doc_id` and `replaceText = replacements` (the whole array mapped
  in one go — item keys `oldText`/`newText`). Filtered to run only when a doc
  id came back and all three numbers are present. Blueprint (secret scrubbed)
  in `make-blueprints/ccm-sales-call-numbers.blueprint.json`.
- The Google Docs module's field names aren't discoverable through the API
  (`/sdk/apps` is custom-apps only); they were found by running a probe
  scenario and reading the errors. Array field = `replaceText`, doc field =
  `document`. Verified end-to-end on a throwaway doc (then trashed).
- GHL workflow "One Call: Client's Numbers Submitted" must point at the
  **numbers** webhook above — not the territory one, which would mint a second
  doc with a 35-mile default radius.
- **2026-10-10 — numbers can be changed after the first fill.** The route
  remembers what it last wrote into each doc (`sales_call_doc_fills`, keyed by
  doc id, applied to V1 and V2 via `scripts/migrate-sales-call-doc-fills.mjs`).
  First run swaps the `{{tags}}`; later runs swap the previous values for the
  new ones. Every value carries an invisible field-specific suffix (zero-width
  chars, `fieldMarker()`), because a bare "1" would match every 1 in the zip
  lists. Docs filled before this change have no markers and no stored row, so
  they can't be updated in place — re-create them (or fix by hand).

---

## 2026-10-06 — Creative hub: folders as collage boxes

The Library's **Folders** view is now browsed like Airbnb wishlists: category
boxes (a 2×2 collage of the first four pictures inside, name, count) → folder
boxes inside a category → the grid of creatives. A category with no folders
opens straight onto its grid; "Needs a folder" and a dashed "New folder" box
sit beside the folders. Breadcrumb at the top to go back up; typing in the
search box cuts straight to a grid across everything. `FolderBox` in
`src/components/CreativeHub.tsx`; no data changes.

## 2026-10-05 — Profit and Loss: moved to Payments; client details

- **Profit and Loss now lives under Payments**, not Tools. Payments lost its
  "Coming Soon" placeholder; tapping it opens Profit and Loss (its only page,
  also listed as a sub-item). The section shows for anyone holding
  `profit_loss` — the feature id is unchanged, so nobody's access moved; it is
  just grouped under "Payments" in Settings > Users. The old
  `/dashboard/tools/profit-and-loss` link and a saved Tools position both
  follow it to `/dashboard/payments`.
- **Edit on a client** (Clients tab) opens a side panel: their details (client
  name, company, contact name, email, phone, website, notes) and their whole
  history, all time regardless of the tab's time frame — total paid, months
  paid, average per month, last paid, a payments-by-month chart and table.
- **Details live in `pnl_clients`**, per user, tied to payment lines by
  `name_key` (the name lower-cased and trimmed) — lines still carry the name as
  text. So **renaming a client renames every one of their lines**
  (`PUT /api/profit-loss/clients`), and renaming onto an existing client's name
  merges the two after a confirm (blank details keep the other client's).
  The page still works if `pnl_clients` can't be read.
- **Schema:** `supabase/migrations/add_profit_loss_clients.sql`, applied to
  **V1 and V2** on 2026-10-05 by `scripts/migrate-profit-loss.mjs` (which now
  runs both Profit and Loss files). One new empty table, additive.
- Checked in a local preview with the sheet's numbers (open, save, rename).
  **Not checked signed in:** the sidebar move and real saving.
- Still open from 2026-10-04, unanswered by the owner: the churn rule (one
  missed month vs two), whether "Deposits" counts as a client, and whether the
  current month should be left out of retention until it ends.

## 2026-10-04 — Sales Tracker (TM Dashboard)

A rebuild of the owner's "Sales Tracker 2026" Google Sheet, under **TM
Dashboard > Sales > Sales Tracker** (`src/components/SalesTracker.tsx`,
`/api/sales-calls`).

- **One table, `sales_calls`** — a row per sales call: date, name, source,
  pricing / pitch, length (min), recording link, outcome (`won` / `lost` /
  `dq` / `na` / `pending`), my emotions, conclusion, notes, contact. Shared by
  everyone with TM Dashboard access (gated on `b2b_tracking`), not per user.
  RLS on with no policies.
- **Totals follow the sheet:** "Total calls" = won + lost; closing % = won ÷
  (won + lost). DQ, N/A and Pending are counted beside it, never in the %.
  Under 30 calls the closing % tile carries the sheet's "little meaning" caveat.
- Time frame: all time / a year / a month. Breakdowns by month and by pitch
  (pitches grouped ignoring case and spacing). Calls list filters by outcome
  and searches name / pitch / notes; click a row for conclusion and notes,
  "Edit" for the form. The page hides the TM date-range picker.
- **Schema:** `supabase/migrations/add_sales_calls.sql`, run with
  `node scripts/migrate-sales-tracker.mjs <v1|v2>` — applied to **V1 and V2**
  on 2026-10-04 (one new table, additive).
- **Sheet data loaded on V1 only**: 48 calls (Jan–Sep 2026; 24 won, 20 lost,
  3 DQ, 1 N/A) via `node scripts/import-sales-tracker.mjs v1
  .sales-import/calls.json` (refuses to run twice; `.sales-import/` gitignored).
  The month tabs were the source; the "2026" tab only filled blank emotions /
  notes. Kimberly Gibbs' "4/31/26" was stored as 4/30/26. Month totals match
  the sheet's tabs.
- **Current pricing** (2026-10-05): "Edit" on the By pricing / pitch panel
  ticks which pitches are on offer now, or adds a new one with no calls yet.
  Stored in `sales_pitches` (one shared list, `/api/sales-pitches`, PUT
  replaces it; same migration file, applied to V1 and V2). Once set, the panel
  shows only those (zeros included), with "Show past pricing too"; the call
  form suggests only current pricing. Empty list = every pitch shows.
- **History loaded (2026-10-05):** the owner's older "Sales Performance
  Tracker" sheet — 217 calls, 2023–2025 (incl. the "No Show & Bad Calls" tab
  as N/A). Year tabs were the source, month tabs added their extra rows and
  filled blanks. Outcome mapping: BAD FIT → DQ, NO PITCH / blank → N/A,
  DEPOSIT → Won. Sources normalised (cc / cc i / Cold call → Cold Call; FB Ads
  → Ads). Dates were in mixed m/d and d/m order, read with the tab's month as
  the tie-breaker; five Jan-2025 rows typed "/22" were taken as 2025, and
  "20/18/25"-style typos as that tab's month. Totals therefore differ from the
  sheet's year tabs (2025: 78 decided vs the sheet's 69).
  The page defaults to the current year; older years only appear when picked
  in the time-frame menu, which lists months for the year in view only.
- **Pitch catalogue (2026-10-05):** `sales_pitches` now has `active`
  (`add_sales_pitch_active.sql`, applied V1 + V2). Un-ticking hides a pitch
  from the panel but keeps it in the catalogue and its calls. In Edit, click a
  name to rename it everywhere (PATCH `/api/sales-pitches` {from,to}; renaming
  onto an existing name merges); open a pitch to see its prospects and move
  one to another pitch (ordinary call PATCH). Picking an old year falls back to
  the pricing actually used then if none of today's pitches has a call in view.
- The 5 calls on the "Copy of August 2026" tab were dated 10/10–10/29/26; the
  owner confirmed they are September, loaded 2026-10-05 as 9/10–9/29 (53 calls
  in total).

## 2026-10-04 — Profit and Loss (new tool)

A rebuild of the owner's "Revenue & Expenses" Google Sheet, under **Tools >
Profit and Loss** (`src/components/ProfitLoss.tsx`, `/api/profit-loss`).

- **One table, `pnl_lines`** — a row per line of a month: `revenue` (a client
  payment), `expense` (business cost) or `personal` (with `leisure` true/false,
  the sheet's Necessary / Leisure split). Scoped per user like the Health
  Tracker; RLS on with no policies, so only the server reads it.
- **Profit = revenue − expenses.** Personal spending sits beside it and is never
  subtracted — same as the sheet. Margin = profit / revenue ("n/a" at $0).
- **Nothing is stored twice.** The sheet's "Years" tab (month table, totals,
  monthly average, highest / lowest month) is the **Overview** tab and its
  client lifetime-value block is the **Clients** tab — both summed in the
  browser from the month lines. "Monthly average" margin is the average of the
  monthly margins, as in the sheet. Clients are grouped by name, ignoring case
  and stray spaces.
- **Clients tab works on a time frame** (All time / a year / last 3, 6, 12
  months counted back from the latest month logged / any From–To). Inside it:
  clients, revenue, average value per client, average monthly per client
  (revenue ÷ client-months), share of revenue, and who is new (first payment
  ever falls in the frame).
  - **Retention is month to month:** of the clients who paid in one month, the
    share who paid again the next. The frame's rate pools every month in it
    ("51 of 91 paid again"); churn is the rest. A client who skips a month
    counts as lost that month and as "Back" when they return — the owner was
    told and may want a 2-month grace instead. A month with nothing logged
    before it has no rate. A $0 line is not a payment.
  - A half-entered current month will read as heavy churn until it is complete.
- An empty month offers **Copy <previous month>** — clients and business
  expenses only, amounts included, to be adjusted.
- **Access:** new feature `profit_loss` (Settings > Users). Restricted accounts
  don't see it until granted; unrestricted accounts see their own empty sheet,
  never anyone else's.
- **Schema:** `supabase/migrations/add_profit_loss.sql`, run with
  `node scripts/migrate-profit-loss.mjs <v1|v2>` — applied to **V1 and V2** on
  2026-10-04 (one new table, additive).
- **The sheet's data is loaded on V1 only**, into the owner's account: 21
  months (Jan 2025 – Sep 2026), 285 lines, revenue $109,898 / expenses
  $48,931.92 / personal $36,045 — via
  `node scripts/import-profit-loss.mjs <email> .pnl-import/lines.json`. The
  script applies the sheet's own client-name clean-up and refuses to run twice.
  `.pnl-import/` is gitignored: real personal finances, never to be committed
  or seeded into V2. The sheet's own "Years" tab stops at August 2026; the app
  includes September.
- Checked in a local preview against the sheet's figures (every month's
  revenue / expenses / personal total matches). Not checked in a logged-in
  browser — no session available to the code session.

## 2026-10-03 — B2B dashboard: click a tile to see where it comes from; unattributed note

- **Every tile on the TM Dashboard is clickable** (52 of them). The panel
  (`StatSourceModal`) shows what the stat measures, the sum behind it using the
  numbers on screen, which system the data originates in, and the actual
  records counted (lead / demo / call / page visit / daily spend rows).
  Definitions live in one catalog, `src/lib/b2b-stat-sources.ts`, keyed by the
  tile's **label** — rename a tile and its entry must be renamed too; change a
  definition in `lib/metrics.ts` or `/api/b2b-metrics` and its entry must
  follow. Records come from `GET /api/b2b-stat-source` (session auth, read-only,
  same date bounds as the two metrics routes). Checked against V1 for
  2026-09-01 → 10-03: all 52 entries' record counts match their tiles.
- Client dashboards are untouched: `KpiCard` only becomes clickable when it is
  passed `onStat`, which only the Tomsi block does.
- **Campaign Overview "missing lead"** (owner saw client row: 2 leads, campaign /
  ad set / ad rows: 1). Not a bug: the client row counts every lead, the rows
  under it only count leads carrying ad attribution, and Connie Harris
  (2026-10-02) has none — `pull_b2b_attribution` dry-run confirms GHL holds no
  ad source for her contact. The drawer now prints a note under the campaign,
  ad set and ad tables whenever the rows add up to less than the total
  ("Not tied to any campaign: 1 lead…"). The rollup itself is unchanged —
  unattributed events are still never spread across ads.

## 2026-10-02 — Creative hub: folders, codes, Facebook history

- **Codes come from where a creative is filed.** Categories (fixed, in
  `CATEGORIES`, `src/lib/creative-key.ts`): `AI` AI image · `TH` talking head ·
  `UGC` · `VO` voiceover. Inside a category, optional **folders** (table
  `creative_hub_folders`; the slug is the first word of the name, upper-case,
  and never changes). Code = `AI/SLOP/001` or `TH/004`: category, folder slug,
  running number per folder (`nextCode`). Moving a creative gives it the next
  number in its new place; a category's first folder can pull in everything at
  the category root (`move_root`) — a category either has folders or it doesn't.
  The Library opens on a **Folders** view (category tabs → folder chips →
  cards), with tick-to-select and a bottom bar to file several at once.
- **Ads are bound by id** (`creative_hub_links`), not by name. The GET matches
  an ad by saved link → code at the front of its Meta name → pooled name, and
  saves new name matches as links. So the Meta name can be changed to
  `<code> <title>` (shown as "Name in Facebook" with Copy) without losing
  history. **Automatic renaming in Meta is built but dormant:** the shared
  token only has `ads_read`; set `META_MANAGEMENT_TOKEN` (a system-user token
  with `ads_management`) and the "Rename in Facebook" buttons go live
  (`/api/creative-hub/push-names`, also run after a save / bulk filing).
- **Tags** (free text on the entry) carry what a creative is made of and its
  angle — `hook-1, body-2, garbage-leads, $1-down` — searchable and shown as
  chips. The owner chose dumb codes + tags over encoding the recipe in the code.
- **B2B filed on V1 (28 coded):** AI/SLOP/001–011 (= AI Slop 1–11, titled from
  the PDF), AI/REALISTIC/001–003 (= Realistic Image 1, 2, 6), TH/001–007 (Hook
  1–5 Body 1, Hook 2 Body 2, Hook 2 Body 3; the four extra hooks got entries
  with their scripts), UGC/001–005, VO/001–002. Left **Uncategorised**: the
  February statics "Ad 1–6", "Winnner (Ad 2) V2", "New Engagement Ad" — the
  owner's call what they are. Nothing was renamed in Meta yet (22 ads still
  carry the old names; the hub flags them).
- **Facebook history pulled into V1 (owner's go-ahead):** every day from
  2026-02-10 to 2026-08-13 through `/api/b2b-ad-spend/sync-all` (145 days with
  data, 670 ad rows), so the B2B hub and timeline run from February. B2B
  **All Time** ad spend is ~$5,800 higher as a result; the Martial-Arts
  campaigns (Nov–Dec 2025) were deliberately left out. Then the whole range was
  re-pulled after fixing the lead count (next bullet).
- **Meta lead count was doubled** in the B2B sync (`lead` total + its parts
  summed); fixed in `b2b-ad-spend/sync-all` and re-pulled. The **client sync
  has the same bug and is untouched** (task chip raised; changes Campaign
  Overview numbers for clients, needs the owner). The hub shows Meta's count as
  "Leads (Facebook)" beside CRM leads — the only lead figure for pre-tracking ads.
- **Attribution finding (not a bug):** CRM credit is first touch. "AI Slop 3"
  read 0 leads because Bruce Sherritt first clicked AI Slop 1 and converted via
  AI Slop 3 (Meta credits the latter), and the other Meta "lead" was a flagged
  fake. B2B leads carry **no `last_touch`** (0 of 19; client leads do) — the
  B2B webhook only reads first touch. Pending the owner: capture last touch for
  B2B and add a First/Last toggle to the hub.
- **Possible lost instant-form leads:** several B2B ads carry a lead form
  (`lead_gen_form_id 1075823084847034`); Meta reports 6 on-Facebook leads since
  Sep 27 with no matching GHL contacts. The read token cannot open the form's
  leads. Flagged to the owner to check Leads Center.

## 2026-10-01 — Creative & Copy Hub (new top-level menu)

One place for every creative: the image/video, the copy, when it ran, and what
only we know about it (prompt, script, what's in the background). New sidebar
section **Creative & Copy Hub**, split **B2B** (Tomsi Media's own ads) and
**B2C** (clients), each with **Library**, **Timeline** and the **Creative
Leaderboard** — which moved here out of the Clients Dashboard and TM Dashboard
(old URLs and saved nav positions follow it).

- **A record is a creative name**, the same key the leaderboard pools on
  (`src/lib/creative-key.ts`, extracted from the leaderboard route). B2C ignores
  word order across clients as before. **B2B matches in order** — one account,
  and "Hook 1 Body 2" / "Hook 2 Body 1" are different ads made of the same
  words. The B2B leaderboard uses the ordered key too (no current rows change).
- **Assembled from three places** by `GET /api/creative-hub?scope=b2b|b2c[&client_id=]`:
  `ad_campaigns` (level `ad`: days delivered → runs, spend, where it ran) ·
  Meta (cached in `creative_hub_meta`) · `creative_hub_entries` (ours).
  Outcomes are first-touch, all time, via `rollupFunnelByAd` — same counting as
  the leaderboard (B2B counts every demo booked; B2C is unchanged, pending-only).
- **Nothing is stored — media comes straight from Meta** (owner's call, to avoid
  storage cost). `src/lib/creative-hub.ts` asks Meta by **ad id** in batches of
  50 (`META_ACCESS_TOKEN`; verified it reads every client account, not just
  Tomsi's). Per ad: headline, primary text, status, shareable preview link, the
  image, and for videos a **playable source** — so videos play inside the hub.
  - Only the ad-account video (`object_story_spec.video_data.video_id`) is
    readable; the page copy (`creative.video_id`) returns "(#10) no permission".
  - `thumbnail_url` is often the **page's profile picture**, not the ad
    (`/t39.30808-1/`). It is dropped when it is; the grid falls back to
    `image_url` / the video poster.
  - CDN links expire after ~4–5 days. Rows older than 20h refresh in the
    background, older than 72h block the load (`REFRESH_HOURS` / `EXPIRED_HOURS`).
    First ever load of B2C took ~14s; cached loads ~1.5s.
  - The copy stays on the cache row, so it survives an ad being deleted in Meta;
    the picture does not.
- **"Live"** = Meta reports ACTIVE for an ad of that creative that delivered in
  the last 3 days; with no Meta answer, delivery in the last 2 days stands in.
- **Timeline** = delivery days from `ad_campaigns`, gaps of ≤2 days bridged.
  By campaign (expand for its creatives) or by creative. A manual launch date
  shows as a diamond. It does not use Meta's on/off activity log.
- **Ads that are on but haven't served** (added same day, after "AI Slop 5" was
  missing): the spend sync only sees ads with an impression, so an active ad
  with zero delivery never reached `ad_campaigns`. The hub now lists the ads of
  every campaign that ran in the last 30 days (`listCampaignAds`, 15-min memory
  cache) and adds the **ACTIVE** ones it didn't know — shown as Live, "No
  delivery yet", sorted to the top. Paused never-served ads are skipped: client
  accounts are full of them. An ad in a brand-new campaign with no delivery at
  all is still invisible until its first impression.
- **Entries with no ad yet** show as "Not launched" (drafts). Name the ad exactly
  the same in Meta and the preview + results attach on the next sync.
- **Uploads were deliberately not built** — a "source file link" field instead.
- **Access:** new features `creative_hub_b2b`, `creative_hub_b2c`
  (Settings > Users). Restricted accounts don't see the hub until granted. The
  leaderboards keep their old rule (`creative_leaderboard`, plus `b2b_tracking`
  for the B2B one).
- **Schema:** `supabase/migrations/add_creative_hub.sql` — applied to **V1 and
  V2** on 2026-10-01 (two new tables, additive).
- **B2B content loaded (V1 only):** 22 entries from the owner's "B2B Ad
  Scripts" PDF — UGC 1–2, Voiceover 1–2, AI Slop 1–11, Hook 2 Body 1–3, the
  Campaign V1 hook/body bank, and three unused UGC prompts. AI Slop 7 and 8 were
  matched to their prompts by looking at the live images; AI Slop 5, 9, 10, 11
  and the three UGC prompts are not launched. "Realistic Image 1/2/6" had no
  prompt in the PDF.
- **V2** has no ad-level rows in `ad_campaigns`, so its hub is empty apart from
  anything typed in — a V2 data-session matter.
- Not verified in a logged-in browser (no session available to the code
  session): the sidebar wiring. The library, drawer, video playback and
  timeline were checked against real V1 data; save/rename/delete against V2.

## 2026-09-30 — B2B Campaign Overview: KPI-based State, demo counts, funnel rates

Everything here is gated to the internal Tomsi Media row (`clientId` lock in the
components, `is_internal` check in the routes). **The client (B2C) dashboards
are untouched** — the owner asked that nothing B2C change without being asked
first. One B2C finding left alone on purpose, see the end.

- **Why "Excellent" was wrong.** `campaign-overview` scores each row against the
  portfolio *median*. With one row the median is the row itself, so Tomsi Media
  always read Excellent / Healthy. The B2B row is now judged against fixed
  targets in `B2B_KPI_TARGETS` (`src/lib/kpi-targets.ts`), owner-set:
  CPL ≤ $70 · cost per demo **booked** ≤ $90 · CTR ≥ 1% · CPC ≤ $2.50 ·
  landing → booking ≥ 5%.
- **State** (replaces Rank; the right-hand Overall column is dropped for B2B):
  Excellent ≥ 25% better than target on every KPI, On Target = at target,
  Off Target = up to 25% worse, Critical = worse than that; any Critical KPI
  makes the row Critical. Hold = fewer than 5 leads — except an entity that has
  spent ≥ 2× the CPL target with a critical cost per lead, which is Critical.
  The same State shows per campaign / ad set / ad in the drawer tables.
- **Demos were undercounted (1 instead of 11 in September).** A show / no-show
  flips the booked row in place, so counting `appointment_booked` alone gives
  only the demos still pending. B2B now counts pending + shown + no-showed, in
  `campaign-overview`, `client-ad-breakdown` and `creative-leaderboard`
  (`rollupFunnelByAd({ bookedIncludesResolved })`, default off) and the Goal
  Tracker. Sep: $2,145 ÷ 11 = ~$195 per demo (was $2,145 ÷ 1).
- "Appointment" → "Demo" across the Tomsi views (tables, drawer, tiles, nav,
  leaderboard, goal tracker, heat map caption).
- **Funnel Stats:** added Landing → Calendar and Calendar → Booking rates
  (`b2b-metrics`), and a KPI flag on Landing → Booking (5% floor). "Bookings" is
  the thank-you page visit count.
- **Page-visit backfill — not done, blocked.** Tracking only began 2026-09-25.
  Meta only has ad-driven landing page views (187 for Sep 8–24) and the token
  cannot read pixel stats; the GHL API lists funnels but exposes no page-view
  stats. Calendar page visits before Sep 25 exist only in the GHL funnel Stats
  screen. If the owner reads those numbers off, they can be loaded.
- **Left alone (B2C):** the client Campaign Overview / Ads tab has the same
  pending-only appointment count. Not changed — needs the owner's say-so.

## 2026-09-30 — Meta report: landing→booking KPI and ad on/off history

- **Landing page → booking KPI** (owner's target: never below **5%**, aim for
  **7–8%**). Each account-summary window prints the rate with BELOW FLOOR /
  ABOVE FLOOR, BELOW TARGET / ON TARGET, and the KPI line in the AI style block
  carries the same numbers (`LANDING_TO_BOOKING_KPI` in `meta-report.ts`).
  Rate = `visit_thankyou` ÷ `visit_landing` from `b2b_events`, the same
  definition as the dashboard's `landing_to_booking`. Page-visit tracking only
  began 2026-09-25, so L30 and L7 are identical until 30 days have passed — the
  line prints "visits tracked from <date>" to make that visible.
- **Section 5, ad on/off history.** From Meta's account activity log
  (`/act_…/activities`, 180-day lookback): per ad — created, first delivery,
  every turn ON / turn OFF with the time (report timezone) and who did it, plus
  ad set / campaign switches for the ad sets and campaigns in the report. Meta
  logs a switch in steps (Active → Pending process → Inactive); only settled
  states count. If the log is refused the section says so and the report still
  builds. The AI block tells the reader to check live-days before judging L7/L3.

## 2026-09-28 — B2B: one-call demo model, reconciled Sep history, live attribution

- **Cutoff.** The two-call (intro → sales call) process ended in early September.
  Michael Fischer's demo on **2026-09-09 is the first demo**; everything from
  there on is a demo (`sales_call_booked` / `sales_call_shown`). The August rows
  (13 `intro_booked`, 8 `intro_shown`, seeded weekly totals with no names) are
  genuine intro-era records: keep them, but they are **not demos** and reports
  should ignore intros going forward. Do not re-derive this cutoff from the data.
- The B2B webhook now remaps any incoming `intro_booked`/`intro_shown` to the
  demo types (GHL was still tagging some bookings "intro"); `booked_by` accepts
  `client` as an alias of `self`.
- **Guarded data-cleanup tool** (`/api/admin/data-cleanup`, run via
  `node scripts/run-cleanup.mjs <op> [--apply]`, dry-run by default, capped, only
  named ops; a Bash allow rule in `.claude/settings.json` covers that command).
  Ops used today: `relabel_intros_to_demos`, `dedupe_bookings` (blank-ID copies
  of ID-carrying bookings), `reconcile_b2b` (Aug back to intros + the Sep demos
  the tracking missed: Alexi, Zahra, Thomas/Cathleen shows, Cathleen close
  $1,000), `mirror_tomsi_demos` (same demos into the Tomsi client `events`
  mirror, final state, keyed on the appointment ids), `pull_b2b_attribution`.
  The auto-mode guard blocks the `--apply` step for the assistant; the user runs it.
- Sep ledger (owner-confirmed): 9 demos, 4 showed (Michael, Alexi, Thomas,
  Cathleen), 5 no-shows (Zahra, Robin, Derick, Monica, Bryan), 2 closes (Alexi $0,
  Cathleen $1,000).
- **"Demos Booked" = every demo booked in range** (pending + shown + no-showed),
  since a show/no-show flips the booked row in place. Applies to every client
  dashboard; also fixed CP Demo Booked and Appts To Take Place.
- **B2B attribution.** `GHL_API_KEY_B2B` = Private Integration token for the
  Tomsi Media sub-account (location `jdBERcRjjBJ8dkPT9AOu`); `GHL_API_KEY` only
  reaches the client account. This funnel passes Meta's numeric ids through the
  UTM slots (`campaign` = campaign id, `utmTerm` = ad set id, `utmContent` = ad
  id; `adId`/`adSetId` are null) — `mapGhlAttribution` now reads them from there.
  Attribution is pulled **live** in the B2B webhook (4 s cap, best-effort) and
  also flows into the Tomsi mirror; `pull_b2b_attribution` backfills blanks.
- B2B dashboard refresh bugs fixed: section now initialised from the URL on
  first render; stale metric/campaign responses cancelled; Tomsi tables wait for
  the client lock; `tomsiView` defaults to the merged dashboard. Default window
  This Month; "Week Before" preset removed. ROI tile was a hardcoded placeholder.
- Weekly breakdown: calendar weeks Mon–Sun attributed to the month of their
  Monday; full funnel columns; month row recomputes rates from totals.
- Report wording: "kept intro" → "kept demo" everywhere (report + JSON keys);
  `META_KEPT_INTRO_EVENT` still honoured, `META_KEPT_DEMO_EVENT` preferred.
- Pending: the AI "reporting style" block for the Meta report (needs the owner's
  KPI targets: cost per kept demo, CPL, CTR/CPC).

## 2026-09-30 — Client onboarding script

`node scripts/onboard-client.mjs --name "<Client Name>" --account act_<id> [--backfill 30] [--dry-run]`

Does the two things a new client needs on V1: adds the `clients` row (live) and
clones the live Make scenario **7137679** ("CCM - Meta Spend → D and B
Construction", team 875675, folder 356178) as `CCM - Meta Spend → <Client
Name>` with the new `client_name` + `account_id`, same 07:00 daily schedule,
switched on. `--backfill N` calls V1 `ad-spend/sync-all` for the last N days.
Idempotent: skips the row / scenario if they already exist. The Meta token
comes from the template blueprint, so it never needs re-entering.

GHL workflows are the client's own — not part of this script.

Make note: `.env.local` `MAKE_TEAM_ID` (6337002) is the **organization** id;
the team the scenarios live in is 875675.

---

## 2026-09-23 — Funnel engagement tracking (visits + VSL/pre-call watch)

- New event types `funnel_visit`, `vsl_watch`, `precall_watch` + `progress_pct`
  column on `events` and `b2b_events` (migrated V1; V2 events-only, no b2b there).
  Both webhooks accept them; the B2B intake mirrors them into the Tomsi client.
- Video host is **YouTube** (not Wistia). Watch % comes from the YouTube IFrame
  API in a page snippet, fired to a public Make webhook that forwards to
  `/api/webhooks/b2b` with the auth header (secret stays server-side).
- Make scenario **7570422 "CCM - Funnel Engagement → Supabase"**, hook
  `https://hook.eu1.make.com/23vinkmkc69vaypunak8b7dykqd4qiik`. Snippet saved in
  the session scratchpad as `tomsi-funnel-tracking.html`.
- **User to-do in GHL:** paste the snippet into the funnel page; embed the YT
  videos with `id="vsl"` / `id="precall"` and `enablejsapi=1`; make the funnel
  link carry `?cid={{contact.id}}`.
- Not built yet: dashboard KPIs/correlation (show/close by watch depth) — deferred
  until real data flows.

# Project Notes — running log

Append-only log of decisions and state that isn't obvious from the code or git
history. Newest entries at the top. Read this before starting work; add to it
when you make a call that a future session would otherwise have to re-derive.

---

## 2026-09-25 — Meta B2B report reshaped to the Hormozi-AI paste spec

> **Later the same day: Slack dropped.** The user decided against a Slack bot,
> so the report is now **on demand**: `GET /api/meta-b2b-report` (session auth
> or bearer secret; `?format=json`, `?download=1`) behind a **"Meta report"**
> button next to the date picker on the TM Dashboard. `src/lib/slack.ts`, the
> cron route and its bypass entry are gone; Make scenario 7581936 is **stopped**
> (not deleted) in case a schedule is wanted again. Only `META_ACCESS_TOKEN` is
> needed now. On 2026-09-25 (with the user's go-ahead) it was copied from Make
> scenario 7112516's query string into `.env.local` and the Railway **dashboard
> v1** variables. The route is in `BYPASS_ROUTES` because it checks session or
> secret itself.
>
> **Per-ad kept intros are N/A on V1 today** (`kept_intro_source = none`): the ad
> account has **no custom conversions** at all (so no "Schedule Kept"; the pixel
> does fire 28 unnamed `fb_pixel_custom` events/30d), and `b2b_events` has no ad
> attribution — `admin/backfill-ghl-attribution` on `b2b_events` fails with 403
> "token does not have access to this location" because `GHL_API_KEY` is not for
> the Tomsi Media sub-account. Zero_intro_kill and Perf_vs_control_bad render
> **N/A** until one of: a "Schedule Kept" custom conversion in Events Manager,
> a GHL token for the Tomsi location (then run the backfill), or attribution
> custom data on the Tomsi New Lead workflow.

The report (see 2026-09-24) now has four fixed sections: **1. account / funnel
summary** per window (L30 / L7 / L3) in a paste-ready text block — spend, leads,
CPL, bookings, kept intros, closes, CAC, cash, ROAS, speed to lead, dials/lead,
pickup, show, close; **2. ad set table** per window; **3. ad-level table for L7
only** with the five flag columns; **4. creative map** — one line per ad with
format + headline + primary text pulled from the ad's creative in Meta.

- The GHL side comes from the dashboard: `src/lib/b2b-funnel.ts` reads
  `b2b_events` (leads, intro_booked = bookings, intro_shown = kept intros,
  sales calls, close + revenue = cash) and the Tomsi client's mirrored `dial`
  rows in `events` (dials, pickups, speed_to_lead_seconds). Window bounds are
  local days in America/New_York. Read-only; no schema change.
- Per-ad kept intros: GHL attribution (`b2b_events.ad_id` on intro_shown) when
  any exists in the 30-day window, else the Meta "Schedule Kept" custom
  conversion. `kept_intro_source` in the JSON says which. On V1 as of today
  there is **no ad attribution on b2b_events**, so it falls back to Meta.
- Real V1 numbers on 2026-09-25 (L30): 21 leads, 13 intros booked, 2 shown,
  1 close, $0 cash, 28 dials / 5 pickups. `speed_to_lead_seconds` is null on
  every Tomsi dial, so speed to lead prints "—" until GHL sends it; cash is
  $0 because no close row carries revenue.
- Flags are always on L7 (`META_FLAG_WINDOW` removed). Meta-reported leads are
  shown alongside GHL leads when they differ.

---

## 2026-09-24 — Meta B2B prospecting report → Slack (Mon/Wed/Fri 08:00 ET)

`POST /api/cron/meta-b2b-report` (bearer `ADMIN_WEBHOOK_SECRET`) pulls ad-level
insights for the Tomsi Media ad account (`act_1080664784142903`) over three
windows — 30 / 7 / 3 days **including today** (America/New_York) — plus the
previous 7 days for the "what changed" bullets, and posts to Slack: a summary
message (bullets + flagged ads), then `report.md` (all tables) and `report.json`
(machine-readable, same data) in the thread. `GET ?format=json|md` returns the
report without posting; `POST {"dry_run":true}` builds it and returns the Slack
text. Logic lives in `src/lib/meta-report.ts`, Slack calls in `src/lib/slack.ts`.

- Scheduled by Make scenario **7581936** "CCM - Meta B2B Report → Slack"
  (team 875675, folder 356178): days Mon/Wed/Fri, 08:00 in the org timezone,
  which is America/New_York. It calls V1 only.
- **Env (V1 Railway service, not yet set as of 2026-09-24):** `META_ACCESS_TOKEN`
  (the same long-lived token the Make spend scenarios use), `SLACK_BOT_TOKEN`
  (bot with `chat:write` + `files:write`, invited to the channel) and
  `SLACK_CHANNEL_ID`. Optional: `META_REPORT_CAMPAIGNS` (comma-separated exact
  campaign names; unset = every campaign that served in 30d), `META_B2B_ACCOUNT_ID`,
  `META_KEPT_INTRO_EVENT` (custom-conversion name or full action_type; default
  finds a custom conversion named "Schedule Kept"), `META_FLAG_WINDOW` (30/7/3,
  default 7), `REPORT_TIMEZONE`. `SLACK_WEBHOOK_URL` works as a summary-only
  fallback (webhooks cannot attach files). Until the env is set the route
  answers 503 and the Make run shows an error — nothing else is affected.
- Leads = Meta's `lead` action (falls back to pixel + on-site lead parts).
  Kept intros = the "Schedule Kept" custom conversion's action_type. "First
  served" is the ad's `created_time`. Creative type is parsed from the ad name
  (UGC / VO / Static / Carousel / Video / AI).
- Flags follow the spec (eval floor $90 or 1,000 impr; zero-intro kill $135 and
  0 kept; CTR < 50% / < 25% of best 7d CTR with ≥ 250 impr; cost per kept ≥ 1.3×
  best 7d cost per kept with ≥ $180 spend). **Assumption:** an ad's own numbers
  are taken from the 7-day window, matching the "best ad in last 7 days"
  control; `META_FLAG_WINDOW=30` switches to cumulative 30-day numbers. Best-CTR
  control only considers ads with ≥ 250 impressions in 7d.

---

## 2026-09-21 — Task Board: Weekly Non-Negotiables

> **2026-09-22 (later):** sales calls from the connected calendar join the
> checklist. `POST /api/task-templates/calls` reads the week's events, keeps timed
> ones with another attendee or a meeting link (Gym, ISA Dials, SLEEP never
> qualify — on the first run it picked 2 of 51 events), and upserts one task per
> call with `origin = 'calendar'`, `external_key = cal:<user>:<uid>:<start>`
> (unique) and `starts_at`. The title is the person's name — the part of
> "Derick Garner | Custom Area Breakdown Tomsi Media" that matches an attendee.
> Open calls from today on that vanish from the calendar are deleted on sync.
> The browser sends each day's timezone offset so calls land on the user's own
> day. `isNN(t)` in TaskBoard covers both kinds. Live counts now come from the
> item's name, not a stored setting; the strip's order is the templates' order
> (drag in the editor), with calls after them by time.

> **2026-09-22:** non-negotiables no longer sit in the ABCDE columns (the user
> found they crowded out real prioritisation, and one became the frog). They
> render in their own checklist strip above the board — chips for the day in Day
> view, a template × weekday tick grid in Week view — and are excluded from the
> columns, the frog, the day's done count and the day strip. Their letter is no
> longer shown or edited. Their day is locked: they are done that day or not.

Recurring weekly tasks. A **template** (`task_templates`: title, letter/level,
`days` 1=Mon…7=Sun — empty means once, any day that week — and an optional
`count_source`) is turned into ordinary `tasks` rows each week by
`POST /api/task-templates/materialize`, called by the board for the week in view.

- Each copy carries `template_id` + `template_date` (its **slot**). A unique index
  on the pair makes generation idempotent and means a copy that is moved (its
  `task_date` changes, its slot does not) is never generated again.
- Removing a copy from the board sets `scope = 'skipped'` rather than deleting it,
  for the same reason. Skipped rows show nowhere.
- Only the current week and later are generated, and never days before the
  template was created — past weeks are history, not back-filled.
- Editing a template changes only open copies dated today or later; changing its
  days deletes open future copies on days no longer chosen.

**Live counts** (`GET /api/task-templates/counts`) place each Tomsi Media B2B
contact by their latest event: lead → leads to call; intro_booked < 48h → triage
call booked; intro_booked or sales_call_booked ≥ 48h with nothing after → no-show;
sales_call_shown with no close → no-close. The payloads carry **no appointment
time**, only when the event arrived, so the 48-hour upcoming/no-show line is an
approximation. If GHL ever sends the appointment start, use it here.
First run on V1 (2026-09-21): 12 leads, 2 triage, 1 no-show, 0 no-closes.

---

## 2026-09-09 — Calendar reads Google via a private iCal link, not OAuth

The calendar is a **panel inside the Task Board**, not its own tool — a "Calls"
button in the board's date bar opens it beside the columns, following whichever
day is in view (user's call, 2026-09-09; make it a tool again only if asked).
`CalendarView` takes `embedded` + `date` props and hides its own date navigation
when the board supplies them. The user pastes their Google Calendar
**"Secret address in iCal format"** into the tab; it is stored in the new
`calendar_feeds` table (migrated on V1 and V2) and read **server-side only** —
that URL grants read access to the whole calendar, so it is never sent back to
the browser. `/api/calendar` returns only `id`, `label` and any fetch error.

OAuth was considered and rejected for now: it needs a Google Cloud project and a
consent screen, and this is a single-user read-only view. If multiple team
members ever need their own live calendars, that is the upgrade path.

`src/lib/ics.ts` is a dependency-free RFC 5545 reader. It handles TZID wall-clock
times (offsets probed via `Intl`, no tz database), all-day events, RRULE
DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL/COUNT/UNTIL/BYDAY, EXDATE and
RECURRENCE-ID overrides, and skips CANCELLED. Two traps worth remembering:
all-day events sit at **UTC midnight** while the day window is **local**, so they
must be matched by calendar date, not by instant; and occurrences are generated
over a window widened by two days so events spanning a boundary are not lost.
Verified against a synthetic Google-style feed covering all of the above.

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

## 2026-09-13 — Tomsi Media dashboard rebuilt on the client dashboard

- Decision: rather than re-implementing every view against `b2b_*`, Tomsi Media
  is an **internal client** (`clients.is_internal`, created on V1 and V2). The B2B
  webhook and B2B spend sync mirror into `events` / `ad_spend` / `ad_campaigns`
  under it, and the Tomsi Media section reuses the client views locked to that
  id. Details in CLAUDE.md ("Tomsi Media (B2B) dashboard").
- Backfilled the existing real B2B rows into `events` (Maria lead; Michael
  Fischer demo booked/shown) and re-synced 30 days of B2B Meta spend into the
  client spend tables.
- **User to-do (GHL, Tomsi Media sub-account):** install the client-style
  All Dials and No Show workflows posting to the existing client Make webhooks
  with custom data `client_name = "Tomsi Media"` (plus `Phone Call Start Time`
  / `Call Duration` on dials). Without them, calling stats and no-shows stay
  empty for Tomsi.

## 2026-09-13 — B2B is a one-call process; intro stage removed from the views

- The user dropped the 15-minute intro. B2B funnel is now lead → demo booked →
  demo shown → close. Removed from B2B Tracking and the drawer: Booked Intros,
  Intro Show Rate, Cost per Intro, Straight to Demo, and the two intro funnel
  steps. Status/bottleneck logic, the campaign table's Demos/CP Demo/L2D columns
  and the AI context now key off `sales_calls_*`. Ingestion is untouched — the
  Intro Booked/Shown Make scenarios still exist and still accept events.
- **B2B leads are not reaching the dashboard.** Meta reports 10 lead-form leads
  on the new B2B campaign (8–12 Sept); one arrived (the manual test, 9 Sept).
  The Make New Lead scenario has run exactly once since the fix, so the GHL
  New Lead workflow is not firing for Meta lead-form contacts — a GHL trigger /
  filter problem, not ours. Client-side ingestion is healthy (20–40 dials/day).
- `GHL_API_KEY` returns 401 "Invalid JWT" (13 Sept) — likely rotated. Attribution
  refresh depends on it.
- **Self-booked vs team-booked demos.** `b2b_events.booked_by` (`self` | `team`,
  else null) added on V1 + schema/migration/runner; the B2B webhook stores it
  and `b2b-metrics` exposes counts and share-of-leads; two tiles on B2B
  Tracking. The Make `Sales Call Booked` scenario now sends
  `"booked_by": "{{1.customData.booked_by}}"` — **GHL must supply
  `booked_by` as custom data** (`self` when the trigger is the customer booking
  through the calendar link, `team` when booked manually). Until GHL sends it
  the tiles show "—".

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
- **Client-side audit after the B2B fixes:** all client scenarios had the two
  HTTP params except `Agency Onboarding` (added). Appt Booked / Show / No Show /
  Callback stamped `occurred_at` with no offset (Make org time, UTC-4) → those
  events were stored 4h early. Templates now use `...ssZ`. **173 historical rows
  (166 appointment_booked, 7 callback_booked, Jun 19 → Sep 8) still carry the
  4h error** — identifiable by `raw->>'occurred_at'` having no timezone suffix;
  Applied 2026-09-09 with the user's go-ahead: `occurred_at + 4h` on exactly
  those 173 rows, each stamped `raw.tz_corrected = "+4h"` so it can't run twice.
- Meta's own "results" count is never shown as leads: removed the Results / CVR /
  Cost-per-result columns from the drawer ad tables. `ad_campaigns.leads` and
  `b2b_ad_spend.leads` still store Meta's number but nothing displays it; every
  lead figure on screen comes from GHL events.
- `CCM - B2B Cash Collected` (7111670) switched on 2026-09-09 at the user's request.
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


## 2026-09-30 — B2B Overview numbers (shows overcounted, CP Demo Shown / CAC, Leads To Call)

- GHL re-fired "Demo Shown" on 29 Sep for four demos already resolved (Michael
  Fischer, Thomas Cairo, Cathleen Miller, Bryan Moore) and each landed as a new
  show; the shown workflow sends no appointment id, so the mirror flip by
  `external_id` never matched (Bruce Sherritt kept a pending booking next to his
  show). Webhook now: a repeat "shown" for a contact with no newer booking is
  ignored; the mirror flips the contact's latest booking / no-show to `show`.
- Cleanup ops added: `dedupe_shows`, `dedupe_mirror_leads` (Cathleen and a
  "Test" lead were mirrored twice), `mark_test_leads` (leads named "Test" →
  spam). Run via `scripts/run-cleanup.mjs`, user applies with `--apply`.
- B2B tiles: CP Demo Shown = spend ÷ shows, CAC = spend ÷ closes (plain, not the
  chained client formula, which divided by *pending* bookings). Calling Stats
  "Non-Booking Leads" renamed "Leads To Call" (= leads − self-booked); Overview
  "Non-Booking Leads" stays leads that never booked.
- Open: new bookings (Bruce, Pablo) arrive without `booked_by` — the GHL
  self-booked workflow is missing the field.

## 2026-10-03 — Ad spend refreshed three times a day, including today

- The 13 Make spend scenarios (12 clients + B2B) ran once a day at 07:00 and
  asked for *yesterday* only, so the dashboard never showed today's spend.
- `ad-spend/sync-all` and `b2b-ad-spend/sync-all` now sync the requested date
  and then, for a recent request (not a backfill), the following day too —
  today so far (`src/lib/spend-sync-today.ts`). Upserts, so each run overwrites
  today and the next morning's run finalises it. The follow-up is best-effort
  and never changes the response for the requested date.
- Make schedules: 07:00, 13:00, 19:00 (Make org time). No blueprint change.

## 2026-10-10 — Funnel engagement scenario was queueing events

- Make scenario 7570422 (CCM - Funnel Engagement → Supabase, the page-visit /
  video-watch hook) was scheduled **every 15 min with one webhook per run**, so
  events sat in the hook queue and landed one at a time, stamped with the
  processing time. Changed to **run immediately** (like the lead / booking
  scenarios); `occurred_at` now keeps the event's own timestamp when the page
  sends one (`ifempty(1.occurred_at; now)`). Queue drained (6 events).
- VSL added to the confirmation page as a second custom embed (YouTube
  `QYbCOpAf_Rk`, events `vsl_watch`). Both embeds now create the YouTube
  player behind the thumbnail on load, so one click plays (was two).
- GHL's Video element renders a custom embed lazily; it may not render for
  headless/programmatic visits — real visitors are fine.
- Demo bookings now arrive via Make 7111665 (Sales Call Booked) with
  `booked_by` — confirmed by the Test Zaballa booking (self).
- Test contact "Test Zaballa" (LCEMMvD7gEFcc3PuuY6w, exists in GHL since 2025)
  produced a booking + visits on 2026-10-10 — to be removed after the test.
