# Onboarding a New Client — Full Playbook

Self-contained instructions for onboarding a new **remodeling** client of Tomsi
Media onto **SMS**, **Facebook Ads**, or **both**. Written so an AI or person
with no prior context can follow it start to finish. Last updated 2026-11-23,
after onboarding Star Construction And Renovation (both services) and
USA Windows And Doors (SMS, two notification numbers).

Order matters: follow the sections in order. A checkbox list for each service
is in **Section 3**. Details for every step are in Sections 4–10.

---

## 1. Rules that always apply (read first)

1. **The client name is one exact string.** Take the company name exactly as
   written in the client's survey (e.g. `Star Construction And Renovation`).
   Use that identical text for every tag, every workflow name, the Client Name
   contact field, both GHL sub-accounts and the dashboard. Systems match on it.
   Never shorten, tidy or re-case it.
2. **Never edit a template.** Always duplicate first, then change the copy.
3. **Money needs the owner's yes, every time.** Before buying any phone number
   (Ready or GHL), show the owner the number/area code and the price and wait
   for "yes". Before turning on any ad, campaign, or raising a budget, ask.
4. **Never type card details, passwords or 2FA codes.** If a sign-in, 2FA or
   "accept terms" screen appears, stop and ask the owner to do it.
5. **DNS: add records only.** Never edit or delete an existing record.
6. **Facebook: new things are created PAUSED. Never delete in Meta — pause.**
7. **If what you see doesn't match this file** (template missing, two possible
   matches, a name that differs), stop and ask. Don't guess.
8. **Publishing:** workflows stay in Draft until the go-live step (Section 9).
   The New Lead workflow must **never** be published before the client's
   Facebook page is connected and chosen in its trigger — it fires on every
   lead form submission otherwise.
9. **Secrets:** never print, paste or commit API tokens, the card vault
   password/key, or card numbers. Never read the card columns of any form.
10. **The dashboard (app.tomsimedia.com) is production** with real client data.

---

## 2. Systems and where things are

| System | What it is | URL / location |
|---|---|---|
| Dashboard | Tomsi Media reporting app (V1, production) | app.tomsimedia.com |
| GHL agency | GoHighLevel, agency "Tomsi Media" | app.gohighlevel.com |
| GHL sub-account **Gonzalo Zaballa** | SMS blasts | location id `IkXBO1I9L3kHUpwhGjP8` |
| GHL sub-account **Ultimate Sub Account Pipeline** ("Ultimate") | Everything else: calendars, workflows, funnels, phone numbers | location id `WdWjvYixD0zSLmXFUMUb` |
| GHL sub-account **Tomsi Media** | Old onboarding form submissions | location id `jdBERcRjjBJ8dkPT9AOu` |
| Ready | Telephony provider for SMS blast numbers | GHL left menu → **Ready** |
| Meta Business Settings | Pages, ad accounts, system users | business.facebook.com/settings |
| Meta Business Suite | Instant forms (Lead ads forms) | business.facebook.com → All tools → Instant forms |
| Ads Manager | Campaigns | adsmanager.facebook.com |
| Landing pages domain | `<companyname>.remodelwithexperts.com` | GHL Ultimate → Settings → Domains |
| Brand assets | Logos and the Facebook cover banner | `~/Documents/TM Backend/Remodeling Logos/` (cover: `Bathroom Facebook Page Banner.png`) |
| Ad creatives | Images/videos per creative | Dashboard → Creative & Copy Hub (B2C) |

GHL page paths (append to `https://app.gohighlevel.com/v2/location/<location id>/`):
`automation/workflows`, `settings/calendars`, `funnels-websites/funnels`,
`settings/phone_number`, `settings/staff/team`, `settings/integrations`.

**GHL editor tip:** the workflow builder sits in a frame that page-reading tools
can't see. Work from screenshots. To change a field: click it, Cmd+A, type.
Zoom the canvas with the fit-to-screen button (bottom left).

### Templates (as actually named)

| Where | Template | Client copy is named |
|---|---|---|
| Gonzalo Zaballa → Automation → folder **Clients** | `CLIENTNAME` | `<Client>` |
| Ultimate → Settings → Calendars (group Remodeling Partners) | `1. CLIENTNAME Appointment Booking` | `<Client> Appointment Booking` |
| Ultimate → Automation → **New Lead Stuff** | `1. Template Fill In Data` | `<Client> Fill In Data` |
| same | `1. Template New Lead` (NOT the `CAPI New Lead` one — retired) | `<Client> New Lead` |
| Ultimate → Automation → **Qualified Lead Stuff** | `1. Template Send Message To Contractor (Facebook Form) (1 Number)` or `(2 Numbers)` | `<Client> Send Message To Contractor (1 Number)` / `(2 Numbers)` |
| Ultimate → Automation → **SMS Stuff → SMS Client Folder** | `SMS: CLIENTNAME Appointment Confirmed`, `SMS: CLIENTNAME No Response` | `SMS: <Client> Appointment Confirmed` / `… No Response` |
| Ultimate → Sites → Funnels → folder **1. Landing Pages** | `1. Template Landing Page` (3 pages) | `<Client> Landing Page` |

Templates named `NOT ACTIVE - …` are not used.

---

## 3. Master checklists

Which sections to do, in order. "Shared" steps are done once even for "both".

### SMS only
- [ ] 4. Dashboard: survey submitted, client exists
- [ ] 5. Client's GHL user exists (stop if not)
- [ ] 6.1 Ready number (owner's yes) → 6.2 blast workflow
- [ ] 7.1 Calendar → 7.2 Ultimate phone number (owner's yes) → 7.3 Fill In Data → 7.4 SMS pair → 7.5 Send Message To Contractor (+ notification email if they gave one)
- [ ] 9. Go live (publish workflows) → 10. Dashboard service = SMS → report

### Facebook Ads only
- [ ] 4. Dashboard: survey submitted, setup pack made (zips + copy)
- [ ] 5. Client's GHL user exists
- [ ] 7.1 Calendar → 7.2 Ultimate phone number (owner's yes) → 7.3 Fill In Data → 7.5 Send Message To Contractor (+ email)
- [ ] 8.1 Funnel (landing page) → 8.2 Domain → 8.3 New Lead workflow (draft)
- [ ] 8.4 Facebook page → 8.5 Business Settings access → 8.6 Instant form with logic → 8.7 Campaign (PAUSED)
- [ ] 9. Go live: connect page to GHL, field mapping, New Lead trigger, publish workflows + funnel, publish campaign on owner's yes
- [ ] 10. Dashboard: link ad account, service = Facebook Ads → test lead → report

### Both
Everything in both lists; calendar (7.1), Ultimate number (7.2), Fill In Data
(7.3) and Send Message To Contractor (7.5) are made **once**. Dashboard service
= **Facebook Ads + SMS**.

---

## 4. Dashboard: the client's survey

1. **Make the client link:** Dashboard → Clients → **New Client Survey**. Fill in
   page one (service: Facebook Ads / SMS / Both, price per appointment,
   prepaid appointments, cash collected) → **Create Client Link**. Send the
   link to the client (the owner usually does this).
2. The client fills in the rest at `/survey/<token>` without signing in.
   Answers you will need later:
   - Company name (exact), owner first/last name, owner phone, email, website
   - Full address, city, state, zip (zip → phone area code)
   - Main company phone
   - Phone number(s) for appointment notifications (one or two) and
     notification email if any
   - Weekly availability for appointments
   - Services offered, starting prices (full/partial kitchen, full/partial bath)
   - Service area: **miles out** (default) **or a pasted list of zip codes**
     (the survey has a "Use a list of zip codes instead" switch)
   - Financing, minimum credit, years in business
   - Monthly ad spend (Facebook clients)
3. **On submit** the dashboard automatically: creates the roster client,
   billing profile, Stripe customer, marks them closed in GHL, and for
   Facebook clients makes the **Facebook Setup** box (Clients → Submitted
   Surveys → the client):
   - **Zip codes** inside their radius (or their pasted list) — Copy All.
   - **Copy pack** — primary texts, headlines, descriptions filled with their
     name, city, prices — from the active copy template.
   - If something is missing it shows a warning; **Make Again** rebuilds.
4. Older clients may have a GHL form submission instead: Tomsi Media
   sub-account → Sites → Forms → Submissions → "Remodeling Onboarding Form".
   **Do not read or copy the card columns.** "Amount Collected" there means the
   client's current monthly revenue, not money paid to us.

---

## 5. Client's GHL user (check before anything else)

Ultimate → Settings → **Users / My Staff** (two pages). The client's own user
(their name from the survey) must exist — the calendar and Fill In Data need
it. **The owner's side creates it, not you.** If missing, stop and tell the
owner.

---

## 6. SMS-only steps

### 6.1 Ready phone number (costs money — owner's yes)
1. GHL left menu → **Ready** → More → **Numbers** → **Buy number**.
2. **Sub-account = Gonzalo Zaballa** (it opens on the agency — change it).
   Type **SMS**. Search the **area code of the client's address zip**.
3. You choose an area code, not a specific number. Area codes can be
   **Sold out** (954, 754, 561, 305, 786 all were for Florida) — ask the owner
   which nearby code to use; never pick yourself.
4. Stop, tell the owner the area code and the price (about $2/month), buy on
   "yes". **Never press Buy twice** — the list needs a reload to show the new
   number; reload and search before anything else.
5. Row ⋮ → **Rename** → label = exact company name.

### 6.2 Blast workflow (Gonzalo Zaballa sub-account)
1. Automation → folder **Clients** → scroll the list right → `CLIENTNAME` row
   ⋮ → **Duplicate workflow** → type the exact company name as the new name.
   (The copy lands as Draft in the same folder.)
2. Open it. Steps, in order:
   - *Add Tag*: template tag (e.g. `d and b construction`) → remove it, type
     the exact company name → **Add New tag**.
   - *Update contact field*: **Client Name** = exact company name.
   - *Remove Tag* `homeowner`, *Add Tag* `sms_blasted` — leave.
   - *SMS*: the From number is **inside the message text** as
     `#from:+1XXXXXXXXXX#Hey …` — double-click the digits and type the new
     Ready number's digits (`+1` + 10 digits, no spaces). Leave the message.
   - *Webhook* (posts to the dashboard), *Wait*, *Add Tag*
     `no_answer_to_pitch` — leave.
3. Save. Leave in Draft until go-live.

---

## 7. Shared steps (SMS and Facebook)

### 7.1 Calendar
1. Ultimate → Settings → Calendars → `1. CLIENTNAME Appointment Booking` row
   ⋮ → **Duplicate** → Duplicate.
2. **Basic details:** name `<Client> Appointment Booking`.
3. **Staff & location:** add the client's GHL user first, then remove the
   template's staff (Stirling Shupe). Meeting location → Custom → type
   `{{contact.full_address}}`. **Save changes** (top right) before going on.
4. **Availability:** click the person → Edit → **Customize schedule for this
   calendar only** → set the client's **timezone** (template is New York).
   - A range ("9–5 Mon–Fri") goes in as a range.
   - Specific times go in as **30-minute** windows: "10, 2 and 6" →
     10:00–10:30 AM, 2:00–2:30 PM, 6:00–6:30 PM.
   - Times can be typed: click, Cmd+A, type `10:30 AM`, OK. Set one day, then
     its copy icon → tick the other days → Apply. Save.
5. Booking rules are already 30-minute slots; leave them.

### 7.2 Ultimate phone number (costs money — owner's yes)
1. Ultimate → Settings → **Phone System** → Add Number → Add Phone Number →
   Filter → area code (same as 6.1; for Facebook-only use the address zip's
   area code), Match To **First part of number** → Apply.
2. Stop, show the owner the number and price (about $1.15/month). Buy on "yes".
3. Click the pencil next to the new number:
   - Friendly name `1. <Company>` (`2. <Company>` if they already have one).
   - **Call Recording on**, then **untick "Call recording message"** (it ticks
     itself).
   - Advanced Settings → tick **Whisper Message** → replace the whole box with
     `{{contact.client_name}}` (the picker inserts `undefined …` — remove it).
   - Save.

### 7.3 Fill In Data (Ultimate → Automation → New Lead Stuff)
1. `1. Template Fill In Data` row ⋮ → Duplicate workflow → name
   `<Client> Fill In Data`.
2. Steps:
   - **Trigger Contact Tag:** template tag (`kinetic scaling llc`) → remove,
     type exact company name → Add New tag.
   - **Fill In Contractor's Notes:** fill from the survey:
     Phone Number To Send Appointments Too (first notification number) ·
     State · Company Notes (owner full name, owner phone, city, state, years in
     business, service area, website, financing, minimum credit) · Starting
     Prices (full kitchen, full bathroom, partial kitchen, partial bathroom) ·
     Services Offered (yes/no per service) · **Contractor GHL User ID** (the
     client's user) · **Business Name** = exact company name · Appointment
     Booking Restrictions (leave placeholder) · Owner First Name.
     A blank answer → clear the placeholder, don't leave template text.
   - *Update Tracking Client Field* — leave.
   - *Update Contact Timezone* — set to the client's timezone (template is
     Chicago).
   - *Remove Assigned User* — leave. *Assign To Contractor* — the client's user
     (it reads the Contractor GHL User ID; usually nothing to change).
3. Save. Draft until go-live.

### 7.4 SMS pair (SMS clients only — Ultimate → Automation → SMS Stuff → SMS Client Folder)
Duplicate both:
- `SMS: CLIENTNAME Appointment Confirmed` → `SMS: <Client> Appointment
  Confirmed`. Open *Condition* → on the **SMS** branch swap the tag
  `tomsi media` for the client's tag.
- `SMS: CLIENTNAME No Response` → `SMS: <Client> No Response`. Open
  *Condition* → on **Branch** delete `tomsi media`, add the client's tag.
- In **each**: the From number is not in the SMS steps — it's the workflow's
  **Settings tab → Sender details → From number** → pick the 7.2 number
  (saves by itself).

### 7.5 Send Message To Contractor (Ultimate → Automation → Qualified Lead Stuff)
This notifies the client of each booked appointment.
- **One notification number** → duplicate `1. Template Send Message To
  Contractor (Facebook Form) (1 Number)` → name `<Client> Send Message To
  Contractor (1 Number)`.
- **Two numbers** → duplicate the `(2 Numbers)` template instead.

In the copy:
1. **Trigger (Appointment Status) → "In calendar"** = the client's calendar
   (7.1). It is empty in the template — must be set.
2. The first number comes from the contact field set in Fill In Data —
   nothing to change.
3. **(2 Numbers only)** there are **12** end-of-branch steps named
   **2nd Number** (Internal notification → SMS → To Custom Number). Set every
   one to the client's second number. Fit-to-screen (~34%) shows all 12 along
   the bottom row.
4. **Notification email** (if the client gave one) — add after each
   **2nd Number** (or after each *AI Generated Message* step in the 1-number
   version), all 12 branch ends:
   - Build one: on the first branch, 2nd Number ⋯ → Copy action → click the
     paste icon below it → open the pasted step → Type of notification
     **Email** → Action name `Email Notification` → To User Type **Custom
     email** → the client's email → Subject
     `New Appointment Booked From Tomsi Media - {{contact.name}}` → Message:
     editor's `</>` (source) button → paste:
     ```html
     <p><strong>APPT BOOKED FROM TOMSI MEDIA</strong></p><p>Appointment: {{appointment.start_time}}</p><p>Name: {{contact.name}}</p><p>Phone: {{contact.phone}}</p><p>Email: {{contact.email}}</p><p>Address: {{contact.full_address}}</p><p>Project: {{contact.lead_form_services_question}} - {{contact.lead_form_description_of_project}}</p><p>Timeline: {{contact.lead_form_timeline_question}}</p><p>Budget: {{contact.lead_form_full_project_budget_question}} {{contact.lead_form_partial_project_budget_question}}</p><p>Quick Summary: {{contact.transcript_summary}}</p>
     ```
     → Save action.
   - Then Email Notification ⋯ → **Copy action**; on each other branch's last
     step ⋯ → **Paste below**. Check all 12 bottom rows show *Email
     Notification*. Click **Save** (top right).
   - Done for USA Windows And Doors 2026-11-23 (leads@usawindowsanddoors.com).
5. Save. Draft until go-live.

---

## 8. Facebook-only steps

### 8.1 Landing page funnel (Ultimate → Sites → Funnels → folder 1. Landing Pages)
1. `1. Template Landing Page` row ⋮ → **Clone** → name `<Client> Landing Page`.
2. The cloned pages are named `Home Page Clone`, `Booking Page Clone`,
   `Thank You Page Clone (Clone)`. In the editor's page menu (top centre) →
   each page ⋯ → Edit → rename to `Home Page`, `Booking Page`,
   `Thank You Page`. Leave the URL slugs.
3. **Funnel Settings tab → Head tracking code** — paste exactly, then the Save
   button at the bottom:
   ```html
   <!-- Meta Pixel Code -->
   <script>
   !function(f,b,e,v,n,t,s)
   {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
   n.callMethod.apply(n,arguments):n.queue.push(arguments)};
   if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
   n.queue=[];t=b.createElement(e);t.async=!0;
   t.src=v;s=b.getElementsByTagName(e)[0];
   s.parentNode.insertBefore(t,s)}(window, document,'script',
   'https://connect.facebook.net/en_US/fbevents.js');
   fbq('init', '924012040325043');
   fbq('track', 'PageView');
   </script>
   <noscript><img height="1" width="1" style="display:none"
   src="https://www.facebook.com/tr?id=924012040325043&ev=PageView&noscript=1"
   /></noscript>
   <!-- End Meta Pixel Code -->
   ```
4. **Booking Page** → Edit (editor):
   - First calendar element: Change → booking type **Calendar** → the
     client's calendar (7.1) → Add to page. (Template points at Israel Flores'.)
   - Heading "Why Homeowners Are Choosing **Company Name**": the blue span —
     double-click it, Shift+End, type the company name (stays blue).
   - Second calendar element further down: same calendar.
   - **Footer** (a global section): Company Name → company name; Company
     Phone → main company number; Company Address → **City, State** only.
     Saving asks to sync "across other instances" — that's this funnel's own
     pages; confirm Save.
   - `</>` toolbar icon (page tracking code) → paste:
     ```html
     <script>
     fbq('track', 'Lead');
     </script>
     ```
   - Save.
5. **Thank You Page** → Edit → `</>` → paste:
   ```html
   <script>
   fbq('track', 'Schedule');
   </script>
   ```
   Save.

### 8.2 Domain
1. Ultimate → Settings → **Domains & URL Redirects** → `remodelwithexperts.com`
   → Manage → DNS records → **search the name first** (must not exist) → Add
   Record: type **CNAME**, name = company name, lowercase, no spaces, without
   LLC/Inc (e.g. `starconstructionandrenovation`), target
   `sites.ludicrous.cloud`. Save. **Never edit or delete existing records.**
2. Connected Products → **+ Connect** → Funnel/Website → Connect → type the
   full sub-domain (`<name>.remodelwithexperts.com`) → Continue → Continue →
   "already Authorized" → Add records (reuses the CNAME) → Funnel → pick
   `<Client> Landing Page`, default page **Home Page** → Proceed.
3. Booking page URL is then `https://<name>.remodelwithexperts.com/bookingpage`
   — the Facebook form sends qualified leads here.

### 8.3 New Lead workflow (Ultimate → Automation → New Lead Stuff)
1. Duplicate **`1. Template New Lead`** (not the CAPI one) → `<Client> New Lead`.
2. *Tag As Contractor Company Name*: template tag `tomsi media` → the client's.
3. **Settings tab → From number** = the 7.2 number.
4. Trigger is Facebook Lead Form, Page "Any" — **leave Draft**; the page is set
   at go-live (Section 9).

### 8.4 Facebook page (if the client doesn't have one we run)
Model it on **Super Floor Store And Remodeling's** page.
1. Business Settings (business.facebook.com/settings) → Accounts → **Pages** →
   Add → **Create a new Page** (Facebook's normal "Create Page" screen often
   fails silently — use Business Settings). Name = company name, category
   Remodeler / Contractor. Accepting Meta's terms is the owner's click.
2. **Profile picture:** the client's logo from `Remodeling Logos/` (or their
   website).
3. **Cover photo:** `~/Documents/TM Backend/Remodeling Logos/Bathroom Facebook Page Banner.png`.
4. **Bio:** copy Super Floor Store's bio, swapping their city for the client's.
5. **Details:** city, full address, website, phone, email, services (from the
   survey).
6. **Welcome post:** copy Super Floor Store's welcome post, swapping owner
   first name and city; attach the logo. Publish.
7. No ads/boosts from the page.

### 8.5 Business Settings access (owner may do this; ask if 2FA appears)
1. **Users → System users → Make Integration** → Assign assets → the client's
   **ad account** (full control) and the client's **Page** (full control).
   This is what lets the API (and the dashboard's Build Campaign) work. API
   assignment is blocked — do it by hand.
2. Pages → the client's page → Assign people → **Gonzalo Zaballa**.
3. Ad accounts → the client's ad account → Assign people → **Gonzalo
   Zaballa**, full access.
4. If the client owns the page/ad account, they must accept our access request
   themselves. If you can't tell which ad account is theirs, ask.

### 8.6 Instant form (lead form) — with conditional logic
Must match Super Floor Store's standard form exactly. The API **cannot**
create conditional logic or end pages, so this part is manual in Business Suite.

- Name: `M / D / YY | Tomsi Media | Full` (today's date).
- Form type: **More volume**. **Flexible form delivery: OFF.**
- No intro card. Questions:
  1. Q1 (multiple choice): "Are you within 90 minutes travel time of
     <client city>?" — Yes / No
  2. Q2 (multiple choice): which service — Kitchen / Bathroom / Other
  3. Q3 (multiple choice): when do you want to start — ASAP / 1–3 months /
     3–6 months / Just Researching
  4. Q4 (short answer): describe your project
  5. Email, Full name, Phone, Street address, City, Zip (prefill)
- Questions headline: "We Will Use this Information To Contact You".
- Privacy policy: Facebook's privacy page, link text
  "Visit <Client>'s Privacy Policy."
- **Conditional logic** (turn it on in the form editor):
  - Q1 Yes → Q2; Q1 No → **E2** (non-lead end).
  - Q2 Kitchen or Bathroom → Q3; Q2 Other → Q4 → Q3.
  - Q3 ASAP / 1–3 / 3–6 months → **E1**; Just Researching → **E2**.
- **End pages:**
  - E1 "Qualified Leads": headline "This Is the First Step to Get Your Dream
    Remodel", short description, button **View website** →
    `https://<name>.remodelwithexperts.com/bookingpage`.
  - E2 "End page for non-leads": "Thanks for your interest!", button View
    website → the client's own website. (Choosing **Close the form** as a
    logic target creates this non-lead end page automatically — don't also
    add a manual one.)
- Fastest route: use the dashboard's **Build Campaign** (8.7), which makes the
  form's questions by API; then in Business Suite → Instant forms → that form
  → **Duplicate**, add the logic and end pages above, turn off flexible
  delivery, publish, and use the new form in the ads. Archive the API one.
  (Done this way for Star, 2026-11-23.)

### 8.7 Campaign (created PAUSED)
**Option A — dashboard button (admins):** Clients → Submitted Surveys → the
client → Facebook Setup → **Build Campaign** → choose page, daily budget
(survey ad spend), thank-you link (the booking page), tick creatives from the
B2C Creative Hub → **Preview** → **Build (Paused)**. Then fix the form by hand
(8.6) and point every ad at the form with logic.

**Option B — by hand / via API** (structure copied from live campaigns):
- Campaign `Tomsi Media | Qualified Estimates | MM/DD/YY`, objective
  **Leads**, campaign daily budget, lowest cost.
- Ad set `<City> <N> Miles (Radius) | Feeds, Stories, Reels`: conversion
  location **Instant forms**, page = client's page, radius around the
  business address (or the survey zip list if they gave zips or > 50 miles),
  ages 25–65 with Advantage+ audience, placements FB + IG feed / stories /
  reels / profile feed, 1-day click.
- Ads: one per creative. Media from the Creative Hub; texts = the client's
  **current copy pack** (Creative Hub → B2C → Copy → Clients → the client):
  all primary texts, headlines (3), descriptions as text options. CTA
  **Learn More** → the instant form. Name each ad like the creative's other
  ads so the hub pools results.
- **Prices in creatives:** many images/videos show a price ($8,997,
  $14,997…). Pick creatives whose price matches the client's starting price
  rounded up to the next thousand minus 3 (15k → $14,997). Search ad names
  across accounts to find the right version.
- **Ads Manager drafts are invisible to the API.** To add media to a draft:
  copy it into the client's ad account (API `advideos` / `adimages`), then pick
  it from the account library in the draft. A duplicated video ad only takes an
  image after removing the media and choosing Add image.
- Leave PAUSED. Publishing/turning on is the owner's yes (Section 9).

---

## 9. Go live

Do in this order, after everything above is built.

1. **(Facebook) Connect the client's page to GHL:** Ultimate → Settings →
   Integrations → Facebook → Manage → tick the client's page (sync New Leads)
   → Update and Continue → **Configure field mapping**:
   - Q1 travel time → *Lead form location question*
   - Q2 service → *Lead form services question*
   - Q3 timing → *Lead form timeline question*
   - Q4 description → *Lead form description of project*
   - Email / full name / phone / street / city / zip map themselves.
   Confirm → Save.
2. **(Facebook) New Lead trigger:** open `<Client> New Lead` → trigger
   Facebook lead form submitted → **Page = the client's page**, Form = Any →
   Save trigger.
3. **Check** Send Message To Contractor's trigger "In calendar" = the client's
   calendar.
4. **Publish workflows** (Draft/Publish switch, top right of each — confirms
   "Workflow is now published and live"), only after the owner OKs going live:
   - SMS: blast workflow (Gonzalo Zaballa → Clients), `SMS: <Client>
     Appointment Confirmed`, `SMS: <Client> No Response`, Fill In Data,
     Send Message To Contractor.
   - Facebook: Fill In Data, New Lead, Send Message To Contractor.
5. **(Facebook) Publish the landing-page funnel** — the form's end page sends
   leads to `/bookingpage`; unpublished means a dead page.
6. **(Facebook) Publish/turn on the campaign** — **only on the owner's
   explicit yes**, stating client, campaign, daily budget.

---

## 10. Dashboard finish

1. **Service:** Clients → Client Roster → the client's Service column →
   FB Ads, SMS, or Both.
2. **(Facebook) Ad spend link:** the spend sync links ad accounts to clients by
   name automatically (3× a day). If the ad account name doesn't read like the
   company (e.g. "Samuel AD Account"), there is no button for it: the client's
   `clients.meta_account_id` (V1 Supabase) must be set to `act_<ad account id>`
   (from Ads Manager) — a Claude Code session in the dashboard repo can
   do it. Missed spend days are backfilled automatically on the next sync.
3. **(Facebook) Copy pack:** Creative Hub → B2C → Copy → Clients → the client →
   check the current pack is the one used in the ads (**Make Current**).
4. **Test lead (Facebook):** once live, submit the form once to confirm it
   lands in GHL and the workflows run. Warn the owner first — the client gets
   the notification text/email.

---

## 11. Report to the owner when finished

Short and plain:
- What was created (names of workflows, calendar, funnel, page, form, campaign).
- Phone numbers bought and their monthly cost.
- What is published and what is still Draft / PAUSED.
- Anything skipped, uncertain, or waiting on the owner (GHL user, 2FA, terms,
  ad account access, campaign go-live).

---

## 12. Known gotchas

- Duplicating a workflow from the list (row ⋮ → Duplicate workflow) asks for
  the name — type the final name; no "Copy" to remove. Calendar/funnel
  duplicates may carry "Copy"/"Clone" — remove it.
- Tags are per sub-account: add the client's tag in both.
- Ready numbers don't appear until the page is reloaded.
- GHL's "Paste below" needs the action copied first (step ⋯ → Copy action).
- Facebook page creation via Facebook's own screen fails silently — use
  Business Settings.
- Meta API cannot: build form logic/end pages, see Ads Manager drafts, or
  assign assets to the system user (owner does it in Business Settings).
- The Meta management token expires **2027-01-22** — regenerate before then
  (system user Make Integration, all 13 permissions).
- Clients outside remodeling (e.g. lawn care) are **not** covered: templates,
  copy, form and landing page are remodeling-specific.

---

## Appendix — reference clients

| Client | Service | Notes |
|---|---|---|
| Super Floor Store And Remodeling | Facebook | The model for the Facebook page, instant form (form id `1754800585608166`, page `1386164391238217`) and campaign structure |
| Star Construction And Renovation | Both | First full run, 2026-11-23. Kirkland, WA. Form "11 / 23 / 26 \| Tomsi Media \| Full", campaign $50/day, 5 ads |
| USA Windows And Doors | SMS | Two notification numbers + notification email (2 Numbers workflow) |
