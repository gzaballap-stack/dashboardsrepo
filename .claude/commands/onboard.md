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
- **New Lead workflows stay unpublished** until the Facebook page is connected
  — published early, they fire on every submission.
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

The client's **onboarding form submission** (still a GHL form for now; later the
dashboard's New Client Survey). You need: company name (exact), full address and
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
they cost, what is still unpublished, and anything skipped or uncertain. Tick
the matching steps on the client's card on the Onboarding board if there is one.

## Not confirmed yet (written from dictation — check on screen, then fix this file)
- Where the onboarding form submissions are read from in GHL.
- Who creates the client's **staff user** in the Ultimate sub-account (the
  calendar needs it) — not in the dictation.
- Ready: how a number is bought there (not opened yet).
- Nothing inside a workflow, calendar or funnel has been opened yet — only the
  lists were checked.
- A2 step 3 — which step holds the Client Name field (dictation was unclear).
- Whether a both-services client needs anything different in A4 vs B4.
- Whether the Fill In Data and New Lead duplicates need a name pattern.
- For B5, what else changes in the Qualified Lead copy (tag? first number?).
- Which workflows get **published** at the end, and when New Lead is published.
