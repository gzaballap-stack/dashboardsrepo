# /meta-ads — Make or change a client's Facebook ads, asked for in chat

The owner says things like "make a new ad for Star with the kitchen video",
"lower Super Floor's budget to $40", "pause the overhead-view ad", "add the
Neighbor headline to Luxury's ads". You do it straight through the Meta
Marketing API from this machine. Report in plain words, as few as possible
(see CLAUDE.md).

## Token

`META_MANAGEMENT_TOKEN` in `.env.local` (system user **Make Integration**, app
Tomsi Media Dashboard). Never print it, never put it in a URL you show, never
commit it. It also lives on V1 Railway only — never V2. Check its permissions
first if something is refused:
`GET https://graph.facebook.com/v21.0/debug_token?input_token=<t>&access_token=<t>`.
`META_ACCESS_TOKEN` is read-only (ads_read, read_insights) — fine for looking,
useless for changing.

## Rules (the owner's, 2026-11-23)

- **Anything new is created PAUSED.** Campaigns, ad sets, ads.
- **Ask first, in chat, before anything that spends or spends more:** turning
  anything on, raising a budget, widening an audience on a live ad set,
  changing a bid. Say the client, what changes, the old and new value. Lowering
  a budget or pausing on his request needs no second ask.
- **Never delete** in Meta. Pause instead (deleted ads lose their history).
- Only touch the client he named. If the ad / ad set he means is ambiguous
  (two matches), list them and ask.
- After each change, add a note to the Creative Hub **Changes** log
  (`creative_hub_changes`, via `/api/creative-hub/changes` — see NOTES.md
  2026-10-14) so the timeline shows it.

## Finding things

- Client → ad account: `clients.meta_account_id` (V1 Supabase). Not set →
  the account isn't linked or shared yet; say so.
- What's running: `GET act_<id>/campaigns?fields=name,status,daily_budget`,
  `…/adsets?fields=name,status,targeting,daily_budget`, `…/ads?fields=name,status,creative{id}`.
- The client's copy: their **current** pack on the Copy page (Creative Hub →
  B2C Copy → Clients), `creative_hub_copy_sets` where `client_id` = them and
  `active` = true.
- Creatives: the B2C Creative Hub (`/api/creative-hub?scope=b2c`); a
  creative's image / video is copied from one of its ads into the client's
  account — `copyMedia` in `src/lib/campaign-builder.ts` does exactly that.

## How things are built (copy these — read off the live campaigns)

All in `src/lib/campaign-builder.ts`; reuse its functions (run with `npx tsx`)
rather than rewriting them.

- Campaign "Tomsi Media | Qualified Estimates | MM/DD/YY", OUTCOME_LEADS,
  daily budget on the campaign, LOWEST_COST_WITHOUT_CAP.
- Ad set "<City> <N> Miles (Radius) | Feeds, Stories, Reels", LEAD_GENERATION,
  ON_AD, page as promoted object, radius around the business (zip list when
  over 50 miles), ages 25–65 + Advantage+ audience, FB + IG feed / story /
  reels / profile feed, 1-day click.
- Ad: the creative's media, the client's current copy pack as flexible texts
  (all primary texts, headlines, descriptions), Learn More → the client's
  instant form (`lead_gen_form_id`). Name it exactly like the creative's other
  ads so the hub pools it.
- A whole first campaign: the **Build Campaign** button on the client's
  Submitted Survey does it all (`build()`).

## When finished

Say what changed (client, campaign / ad set / ad, old → new), that new things
are paused, and the Ads Manager link.
