# /onboard — Onboard a signed client in GHL (and Facebook)

The owner says "onboard <client>" and which service (Facebook Ads, SMS, or
both). You do the setup through **his Chrome** (Claude in Chrome — he is already
signed in to GHL, Ready and Facebook). This file is the procedure, as he
dictated it on 2026-11-19. It has **not been run end to end yet** — see
"Not confirmed yet" at the bottom and update this file as each part is proven.

Report back in plain words, as few as possible (see CLAUDE.md).

## Rules that always apply

- **The client name is one exact string.** Take the company name exactly as it
  is written on the onboarding form and use that identical text for every tag,
  on both sub-accounts, and for the Client Name contact field. The dashboard
  matches on it. Never tidy, shorten or re-case it.
- **Templates are never edited.** Always duplicate, then change the copy.
- **Buying a phone number costs money.** Before each purchase, stop and show
  the owner the number and the price; buy only on his yes. Never type card
  details or passwords — if a sign-in or 2FA screen appears, stop and ask him.
- **DNS: add only.** Never edit or delete an existing record.
- **Leave everything you create unpublished (draft)** — the owner's rule for
  the first few clients (2026-11-20); he checks and publishes, and will say
  when to start publishing. New Lead in particular must never be published
  before the Facebook page is connected: it fires on every submission.
- **The client's GHL staff user is created by the owner's side**, not by you.
  If the user is not in the staff list when the calendar needs it, stop and say
  so.
- If anything on screen does not match this file (a template missing, a name
  that differs, two possible matches), stop and ask. Do not guess.
- Facebook **campaigns** are not part of this — he builds those by hand for now.

## Where things are (checked on screen 2026-11-19, read-only)

Agency: app.gohighlevel.com (Tomsi Media). **Ready** is in the left menu of
both the agency and each sub-account.

| | Sub-account | Location id |
|---|---|---|
| SMS blasts | **Gonzalo Zaballa** | `IkXBO1I9L3kHUpwhGjP8` |
| Everything else ("Ultimate") | **Ultimate Sub Account Pipeline** | `WdWjvYixD0zSLmXFUMUb` |

Pages: `…/v2/location/<id>/automation/workflows`, `…/settings/calendars`,
`…/funnels-websites/funnels`. The workflow list sits in a frame — page-reading
tools see nothing there; work from screenshots.

Templates as they are really named (existing clients' copies follow the pattern
on the right):

| Where | Template | A client's copy is named |
|---|---|---|
| Gonzalo Zaballa → Automation → **Clients** | `CLIENTNAME` | `<Client>` |
| Ultimate → Settings → Calendars (group Remodeling Partners) | `1. CLIENTNAME Appointment Booking` | `<Client> Appointment Booking` |
| Ultimate → Automation → **New Lead Stuff** | `1. Template Fill In Data` | `<Client> Fill In Data` |
| same | `1. Template New Lead` | `<Client> New Lead` |
| Ultimate → Automation → **Qualified Lead Stuff** | `1. Template Send Message To Contractor (Facebook Form) (1 Number)` / `(2 Numbers)` | `<Client> Send Message To Contractor …` |
| Ultimate → Automation → **SMS Stuff → SMS Client Folder** | `SMS: CLIENTNAME Appointment Confirmed`, `SMS: CLIENTNAME No Response` | `SMS: <Client> Appointment Confirmed` / `No Response` |
| Ultimate → Sites → Funnels → **1. Landing Pages** | `1. Template Landing Page` (3 steps) | `<Client> Landing Page` |

Templates marked `NOT ACTIVE - …` are not used. A duplicate comes out with
"Copy" in its name — remove it.

## What to read first

The client's **onboarding form submission**. The owner says which entry to use:
for now a GHL form submission he links to; later the client's New Client Survey
in the dashboard. Use only the entry he points at.

GHL submissions: Tomsi Media sub-account (`jdBERcRjjBJ8dkPT9AOu`) → Sites → Forms →
Submissions → form **Remodeling Onboarding Form**. The form has card fields
(name, number, CVC, expiry) — **do not read or copy them**; read the table with
the card columns left out. Its "Amount Collected" column is the client's
current monthly revenue, not money paid. Clients whose answers are already in
the dashboard: Clients > New Client Survey > Submitted Surveys. You need: company name (exact), full address and
zip, city + state, main company number, the phone number(s) appointments /
notifications go to (one or two), weekly availability, services, starting
prices, how far they travel, the client's name as a GHL staff user.

## Part A — SMS client

### A1. Ready phone number
1. Ready is the telephony provider used by the **Gonzalo Zaballa** sub-account
   ("Awesome Automations").
2. In Ready, buy a number **inside the Ready sub-account with the same name as
   the GHL sub-account** (Gonzalo Zaballa).
3. Area code = the area code for the **zip code of the client's address** on
   the form.

### A2. Gonzalo Zaballa sub-account — the blast workflow
1. Automation → **Clients** folder → duplicate the workflow **CLIENTNAME**
   (the template); name the copy the company name.
2. In the copy: create a new tag = the exact company name, add it, and delete
   the template's tag.
3. Update Contact Field step: **Client Name** = the exact company name.
4. SMS step: change **From** to the Ready number just bought, in the same
   format as the template: `+1` and the digits, no spaces or symbols. The
   message itself stays the same.

### A3. "Ultimate" sub-account — calendar
1. Settings → Calendars → duplicate **1. CLIENTNAME Appointment Booking**.
   Rename the copy `<Client name> Appointment Booking` (the client name
   replaces `1. CLIENTNAME`).
2. Staff & location: remove whoever is on the template (Gonzalo Zaballa) and
   select the **client's own user** from the staff list (their name is on the
   form).
3. Meeting location: the contact's full address — use the merge-field picker,
   Contact → Full Address.
4. Availability: click the person → Edit → set the schedule (customise for this
   calendar only) to the form's **weekly availability**. A range ("9–5 Mon–Fri")
   goes in as a range. Specific slots go in as **30-minute** windows: 10, 2 and
   6 become 10:00–10:30, 2:00–2:30, 6:00–6:30.

### A4. "Ultimate" sub-account — New Lead Stuff
1. Automation → **New Lead Stuff** → duplicate **1. Template Fill In Data**;
   name it `<Client> Fill In Data`.
2. Change the contact tag to the exact company name (same as A2).
3. Fill in the contractor's notes from the form: phone number, distance for
   appointments, contractor state, company note, starting prices.
4. Contractor GHL user ID: the client's staff user (same person chosen on the
   calendar).

### A5. "Ultimate" sub-account — phone number
1. Phone System → add a new number. Same **area code** as A1 (filter so it is
   the first part of the number). Stop for the owner's yes, then buy.
2. Edit configuration: name it `1. <Company name>` (same pattern as the
   others). **Call recording on**, the **call-recording message off**.
3. Advanced settings: **whisper message on**; the whisper is the contact's
   client name (merge field Contact → Client Name).

### A6. "Ultimate" sub-account — SMS Stuff
Automation → **SMS Stuff** → the SMS client folder. Duplicate both templates:
- **SMS: CLIENTNAME Appointment Confirmed**: open the condition, and on the SMS
  branch change the tag to the exact company name. **From number** = the number
  bought in A5.
- **SMS: CLIENTNAME No Response**: open the condition, on the tags branch delete
  the **Tomsi Media** tag and add the client's tag. **From number** = the A5
  number.

Tracking and the rest are automatic once the onboarding form is in.

## Part B — Facebook Ads client

### B1. Calendar
Exactly as A3.

### B2. Funnel
"Ultimate" sub-account → Sites → Funnels → folder **1. Landing Pages**.
1. Duplicate **1. Template Landing Page**; rename it `<Client name> Landing
   Page`.
2. Settings → head tracking code — paste exactly:

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

3. Steps → Booking Page → Edit. In the editor:
   - Calendar element: booking type **Calendar**, select the client's calendar
     (B1).
   - "Why Homeowners Are Choosing **Company Name**": replace Company Name with
     the company name, keep it blue.
   - The second calendar element further down: select the same calendar.
   - Footer: Company Name → the company name; Company Phone → the main company
     number; Company Address → **city, state** only.
4. Booking page → tracking code — paste exactly:

```html
<script>
fbq('track', 'Lead');
</script>
```

5. Pages → the **booking page clone** → tracking code — paste exactly:

```html
<script>
fbq('track', 'Schedule');
</script>
```

6. Settings → Domains & URL Redirects → **remodelwithexperts.com** → Manage DNS
   Records → Add Record: type **CNAME**, target `sites.ludicrous.cloud`, name =
   the company name with no spaces and without "LLC" / "Inc" etc. Save.
7. Connect the new sub-domain to the funnel just created.

### B3. Phone number
As A5.

### B4. New Lead Stuff
Automation → **New Lead Stuff**:
1. Duplicate **1. Template Fill In Data** and fill it in, as A4.
2. Duplicate **1. Template New Lead**. **Leave it unpublished.** In "Tag as Contractor
   Company Name" change the tag to the exact company name; in its settings set
   **From number** to the number bought in B3.

### B5. Qualified Lead Stuff
Two templates: `1. Template Send Message To Contractor (Facebook Form) (1
Number)` and the same with **(2 Numbers)**.
- One notification number on the form → duplicate the 1-number template.
- Two numbers → duplicate the 2-number template, then at the end of **every**
  branch open the internal notification called "Second Number" and change the
  custom number to the client's second number from the form.

### B6. Facebook Business settings
(He is signed in; if it asks for 2FA, stop and ask.)
1. Business Settings → Users → System Users → **Make Integration** → ⋯ →
   Assign Assets → the client's **ad account**, with as much access as offered.
   If the ad account is not obviously the client's, ask.
2. Pages → the client's page → Assign People → **Gonzalo Zaballa**.
3. Ad Accounts → the client's ad account → Assign People → **Gonzalo Zaballa**,
   full access.

## Both services
Do Part A and Part B; the calendar and the "Ultimate" phone number are made
once and shared.

## When finished
Tell the owner: what was created (names), the phone numbers bought and what
they cost, what is still unpublished, and anything skipped or uncertain.

## Confirmed on screen (first real run, USA Windows And Doors, 2026-11-20)

- **Client's GHL user:** Ultimate → Settings → Users (two pages). Check it is
  there **before anything else** — the calendar (A3) and Fill In Data (A4) both
  need it. Not there → say so straight away.
- **Ready (A1):** left menu → Ready → **More → Numbers → Buy number**. Set
  **Sub-account = Gonzalo Zaballa** (it opens on "gzaballap (Agency)"), type
  **SMS**, search the area code. $2 a month there. You pick an area code, not a
  number — the number is only known after buying. Area codes can be **Sold
  out** (954, 754, 561, 305, 786 all were): ask the owner which nearby code to
  use, never choose for him. Existing numbers are labelled with the client name.
- **GHL number (A5):** Ultimate → Settings → Phone System → Add Number → Add
  Phone Number → Filter → type the area code, Match To **First part of number**
  → Apply. $1.15 a month. Friendly names are `1. <Company>` (`2. <Company>` for
  a second).
- **Duplicating a workflow:** scroll the list right → row ⋮ → Duplicate
  workflow → it asks for the name there (type the final name; no "Copy" to
  clean up). The copy lands in the same folder as a Draft.
- **The workflow editor sits in a frame** the page tools cannot read: work from
  screenshots. Click a value, Cmd+A, type — one field at a time works.
- **Fill In Data (A4), what is really in it:** trigger *Contact Tag* (template
  tag `kinetic scaling llc` → remove, type the company name, **Add New tag**) →
  *Fill In Contractor's Notes* (Phone Number To Send Appointments Too · State ·
  Company Notes: owner full name, owner phone, city, state, years in business,
  service area, website, financing, minimum credit · Starting Prices: full
  kitchen, full bathroom, partial kitchen, partial bathroom · Services Offered:
  yes/no per service · Contractor GHL User ID · Business Name = exact company
  name · Appointment Booking Restrictions (other clients left the placeholder)
  · Owner First Name) → *Update Tracking Client Field* (Client Name = the
  contact's company name, nothing to change) → *Update Contact Timezone*
  (template is Chicago — set the client's) → *Remove Assigned User* →
  *Assign To Contractor* (the client's user). Blank answers: clear the
  placeholder rather than leave it.
- Existing clients' copies are named `<Client> Fill In Data`.
- **Ready, after buying:** the list needs a reload to show the new number
  (never press Buy twice — reload and search first). Then row ⋮ → **Rename** →
  label = the company name (saves as you type). It was $1.50 a month.
- **GHL number settings (A5):** the pencil next to the number right after
  buying. Friendly Name `1. <Company>`; Call Recording on (this ticks "Call
  recording message" by itself — **untick it**); Advanced Settings → tick
  Whisper Message → the picker inserts `undefined {{contact.client_name}}`:
  replace the whole box with `{{contact.client_name}}`. Save.
- **Blast workflow (A2), what is really in it:** no trigger → *Add Tag*
  (template tag `d and b construction` → the client's, Add New tag — tags are
  per sub-account) → *Update contact field* (Client Name = exact company name)
  → *Remove Tag* (`homeowner`, leave) → *Add Tag* (`sms_blasted`, leave) →
  *SMS* → *Webhook* (posts `sms_sent` + the Client Name field to the
  dashboard, leave) → *Wait* → *Add Tag* (`no_answer_to_pitch`, leave). The
  From number is **inside the message text**: `#from:+1XXXXXXXXXX#Hey …` —
  double-click the digits and type the Ready number's digits.
- **SMS Stuff pair (A6):** in each copy open *Condition* and swap the tag
  `tomsi media` for the client's (on the **SMS** branch in Appointment
  Confirmed, on **Branch** in No Response). The **From number is not in the SMS
  steps** — it is the workflow's **Settings tab → Sender details → From
  number** (pick the A5 number; saves by itself). Nothing else in them is
  client-specific.
- **Calendar (A3), confirmed on Renown Baths / American Home Improvement:**
  Settings → Calendars → template row ⋮ → Duplicate → Duplicate. Basic details:
  name. Staff & location: the template's staff is **Stirling Shupe** (not
  Gonzalo) — add the client's user first, then remove Stirling; meeting
  location Custom → type `{{contact.full_address}}`. **Save changes** (top
  right) before Availability. Availability → the person → Edit → **Customize
  schedule for this calendar only** → set the client's timezone (template is
  New York) → times can be typed (click, Cmd+A or End+Backspace, type
  `10:30 AM`, OK). Set one day, then its copy icon → tick the other days →
  Apply; adjust the odd days. Save. Booking rules already 30-minute slots.
- **One notification number:** duplicate `… (1 Number)` too (owner: yes for
  SMS clients). Its only client-specific setting found so far is the trigger's
  **In calendar** (empty in the template) → the client's calendar.
- **Fill In Data timezone:** set it to the client's (Pacific for California).
- **Two notification numbers (SMS clients too, owner 2026-11-20):** duplicate
  `1. Template Send Message To Contractor (Facebook Form) (2 Numbers)` in
  Qualified Lead Stuff. It has **12** end-of-branch steps called *2nd Number*
  (internal notification → SMS → To Custom Number): set every one to the
  client's second number. Zoom the canvas out (fit-to-screen, about 20%) and
  work across; pan to reach the two outermost. Its trigger also has an **"In
  calendar"** box that must be set to the client's calendar — so the calendar
  (A3) comes first.

## Not confirmed yet (written from dictation — check on screen, then fix this file)
- Everything in Part B is still as dictated (not opened).
- USA Windows And Doors' calendar and Fill In Data user are waiting on his GHL
  user (as of 2026-11-20).
- Where a notification **email** from the form goes (the first number is in
  Fill In Data, the second in the 2 Numbers workflow).
- What else changes in the Send Message To Contractor copy besides the trigger
  calendar and the 2nd Number boxes.
- A2 step 3 — which step holds the Client Name field (dictation was unclear).
- Whether a both-services client needs anything different in A4 vs B4.
- Whether the New Lead duplicate needs a name pattern (Fill In Data: confirmed).
- For B5, what else changes in the Qualified Lead copy (tag? first number?).
