# /start — Reporting Dashboard Setup

You are setting up a call center reporting dashboard from scratch. Work through the steps below in order, reporting progress at each step. Do not stop unless a step fails.

---

## Step 1 — Read and validate .env.local

Read the file `tracking-app/.env.local` (relative to this workspace root).

Check that ALL of the following variables are present and have real values — not placeholder text like `your-key-here`, `xxxx`, or an empty string:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Must be a real `https://xxxxx.supabase.co` URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Long JWT starting with `eyJ` |
| `SUPABASE_ACCESS_TOKEN` | Starts with `sbp_` |
| `ADMIN_WEBHOOK_SECRET` | Any non-empty string |
| `MAKE_API_KEY` | UUID format |
| `MAKE_TEAM_ID` | Numeric ID |
| `MAKE_REGION` | e.g. `eu2` or `us1` |

If any are missing or still placeholder, **stop immediately** and list exactly which ones the user needs to fill in. Tell them where to find each value. Do not continue until they confirm.

Extract and remember these values:
- `PROJECT_REF` = the subdomain from `NEXT_PUBLIC_SUPABASE_URL` (the part between `https://` and `.supabase.co`)
- `ACCESS_TOKEN` = value of `SUPABASE_ACCESS_TOKEN`
- `MAKE_API_KEY`, `MAKE_TEAM_ID`, `MAKE_REGION` from the file

---

## Step 2 — Apply Supabase schema

Read the full contents of `tracking-app/supabase/schema.sql`.

Execute it against Supabase by running this bash command (replace placeholders with real values):

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(cat tracking-app/supabase/schema.sql | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"
```

If the response contains an error, report it and stop. If it succeeds (returns an empty array `[]` or list of rows), continue.

---

## Step 3 — Update Supabase max rows

By default Supabase caps queries at 1000 rows. Update it to 100,000:

```bash
curl -s -X PATCH "https://api.supabase.com/v1/projects/{PROJECT_REF}/postgrest" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"max_rows": 100000}'
```

Confirm `max_rows` is `100000` in the response.

---

## Step 4 — Import Make blueprints

### 4a — Create a Make folder

```bash
curl -s -X POST "https://{MAKE_REGION}.make.com/api/v2/scenarios-folders" \
  -H "Authorization: Token {MAKE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Reporting Dashboard", "teamId": {MAKE_TEAM_ID}}'
```

Extract the folder `id` from the response. Call it `FOLDER_ID`.

### 4b — Import each blueprint

For each of these blueprint files in `tracking-app/make-blueprints/`, import it (skip `ccm-agent-claim.blueprint.json` if it exists — that's a different system):

- `ccm-new-lead.blueprint.json`
- `ccm-appt-booked.blueprint.json`
- `ccm-show.blueprint.json`
- `ccm-no-show.blueprint.json`
- `ccm-dial.blueprint.json`
- `ccm-callback.blueprint.json`
- `ccm-onboarding.blueprint.json`

For each blueprint, run:

1. Read the blueprint JSON file
2. Null out any hook IDs (set `blueprint.flow[0].parameters.hook` to `null` if it exists) — Make will create a fresh webhook on first open
3. Create the scenario:

```bash
curl -s -X POST "https://{MAKE_REGION}.make.com/api/v2/scenarios" \
  -H "Authorization: Token {MAKE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"teamId\": {MAKE_TEAM_ID},
    \"folderId\": {FOLDER_ID},
    \"blueprint\": <JSON_STRING_OF_BLUEPRINT>,
    \"scheduling\": \"{\\\"type\\\":\\\"indefinitely\\\",\\\"interval\\\":900}\"
  }"
```

Note: `blueprint` must be a JSON-encoded **string** (the blueprint object serialized to a string), not an object.

After each import, report: ✓ `ccm-new-lead` imported (scenario ID: 12345)

If a blueprint fails, note the error and continue with the rest.

---

## Step 5 — Done! Tell the user what to do next

Print a summary like this:

```
✓ Supabase schema applied (9 tables created)
✓ Supabase max rows updated to 100,000
✓ Make blueprints imported:
    ✓ ccm-new-lead (ID: ...)
    ✓ ccm-appt-booked (ID: ...)
    ✓ ccm-show (ID: ...)
    ✓ ccm-no-show (ID: ...)
    ✓ ccm-dial (ID: ...)
    ✓ ccm-callback (ID: ...)
    ✓ ccm-onboarding (ID: ...)

── Manual steps remaining ────────────────────────────────

1. RAILWAY DEPLOYMENT
   - Push tracking-app/ to a new GitHub repo
   - Connect Railway (railway.app) → New Project → Deploy from GitHub repo
   - Add all environment variables from .env.local in Railway's Variables tab
   - Note your Railway URL (e.g. your-app.up.railway.app)

2. ACTIVATE MAKE SCENARIOS
   - Open each scenario in Make (they're in the "Reporting Dashboard" folder)
   - Click the webhook module → copy the webhook URL
   - Turn the scenario ON

3. SET UP GHL WORKFLOWS (one per event):
   - New Lead          → ccm-new-lead webhook URL
   - Appointment Booked→ ccm-appt-booked webhook URL
   - Appointment Showed→ ccm-show webhook URL
   - Appointment No-Showed → ccm-no-show webhook URL
   - Call Ended (outbound) → ccm-dial webhook URL
   - Callback Booked   → ccm-callback webhook URL

4. ADD YOUR FIRST CLIENT
   - Log into your dashboard → Settings → add a client
   - The client name must exactly match the value Make sends as `client_name`

5. TEST
   - Trigger a real GHL event (e.g. create a contact)
   - Check Supabase Table Editor → events table
   - Confirm it appears on the dashboard
```
