# Cycling a Client's Phone Number — Playbook

Self-contained instructions for replacing the phone number a client's texts are
sent from, without breaking conversations already in progress. Companion to
`ONBOARDING.md` (read its Section 1 rules and Section 2 "where things are"
first). Written 2026-11-23 from the owner's description; **first real run:
Luxury Renovations, 2026-11-24** (screens below confirmed then).

---

## Why there are two numbers per client

Each client has **two** numbers in the "Ultimate" sub-account's Phone System,
named `1. <Company>` and `2. <Company>`:

- **`2. <Company>`** = the **current** number. Every workflow sends from it.
- **`1. <Company>`** = the **previous** number. Nothing sends from it any more,
  but it stays alive because leads it already texted may still reply or call
  it. If it were deleted, those conversations would fall back to a different
  number — very bad. So the old number is kept until the next cycle.

A number gets cycled when it is burned (flagged as spam, low delivery, etc.) —
the owner decides when.

---

## Rules

1. **Owner's yes before buying** the new number: show the area code, the
   number and the price (about $1.15/month). Never buy twice.
2. **Owner's yes before deleting**: name the exact number and its friendly
   name. Deleting releases the number for good — it cannot be undone.
3. **Same client only.** Friendly names are `1. <Company>` / `2. <Company>`
   with the exact company name. If the names don't match that pattern, or the
   client has only one number or more than two, stop and ask.
4. Never type card details or passwords; stop at any 2FA / sign-in screen.

---

## Before you start — write these down

Ultimate (location `WdWjvYixD0zSLmXFUMUb`) → Settings → **Phone System**.
Find the client's two numbers:

| | Friendly name | Number |
|---|---|---|
| OLD (will be deleted) | `1. <Company>` | (write it down) |
| CURRENT (becomes the kept old one) | `2. <Company>` | (write it down) |

Then list **every workflow that sends from the CURRENT number** (Section 5
below says where to look). You'll need this list after buying the new number.

**Client with only one number (`1. <Company>`)** — first cycle: skip steps 1
and 2. Keep `1.` as the kept old number, buy the new one as `2. <Company>`,
and move the workflows to it (steps 3–5).

**SMS-only clients (owner, 2026-11-25)** — one number only, named just
`<Company>` (no `1.` / `2.`). Cycle: buy the new one (step 3, same area code)
named `<Company>`, give it the old one's settings (step 4), switch the
workflows (step 5), then delete the old one. Nothing is kept. First done on
D and B Construction. Check `clients.service` in the dashboard (`sms` /
`facebook_ads` / `both`) to tell which kind a client is.

**Safer order (used 2026-11-25):** buy and set up the new number and switch
the workflows *before* deleting or renaming anything — nothing is ever left
pointing at a deleted number.

---

## Steps

### 1. Delete the OLD number (`1. <Company>`)
Owner's yes first (Rule 2). Phone System → the `1. <Company>` row → ⋮ →
**Delete Number** → the box names the number — check it → type `Delete` →
**Confirm Delete**. (The list is sorted by number and has two pages; the
search box only matches digits, not names.)

### 2. Rename CURRENT from `2.` to `1.`
Phone System → ⋮ next to `2. <Company>` → **Edit Configuration** → Friendly
name `1. <Company>` → Save. Change nothing else.

### 3. Buy the NEW number, named `2. <Company>`
Same as `ONBOARDING.md` 7.2:
1. Phone System → Add Number → Add Phone Number → Filter → the client's
   **area code** (from their address zip), Match To **First part of number** →
   Apply.
2. Owner's yes (Rule 1) → tick one → **Proceed to Buy** ($1.15/month) — it
   spins a few seconds; never click twice.
3. The next box says purchase successful and **A2P is linked automatically**;
   the pencil next to the number opens its settings (step 4). The new number
   shows **A2P In Progress** for a while before **A2P Verified**.

### 4. Give the NEW number the same settings
**Copy the old number, not a fixed list.** Before step 1, open the current
number's Edit Configuration and note its three tabs. Then on the new number
(it comes named `Tomsi's number`, recording off):
- Friendly name `2. <Company>`.
- **Call Recording on**, then **untick "Call recording message"** (it ticks
  itself).
- Advanced Settings: match the old number. New clients get **Whisper
  Message** = `{{contact.client_name}}`, but older clients may have it off
  (Luxury Renovations did) — then leave it off. SAS, Super Floor and D and B
  had `{{contact.name}} from {{contact.client_name}}` (shown with a stray
  `undefined` in front — leave that out). Call Connect is on by default.
- Check the list afterwards: one Save silently didn't take (the window
  resized mid-edit) and the number was still `Tomsi's number`.
- Call Forwarding: match the old (usually empty). Save.

### 5. Switch every workflow from the old number to the NEW number
Ultimate → Automation → workflows. Search the client's name. **The results
table scrolls inside itself** — scroll it, or you miss the last rows (the
first Luxury check missed `No Response`). Open each one's **Settings** tab and
look at **From number**. A client's sending number can be in:

| Workflow | Folder | Where the number is |
|---|---|---|
| `SMS: <Client> Appointment Confirmed` | SMS Stuff → SMS Client Folder | **Settings tab → Sender details → From number** |
| `SMS: <Client> No Response` | same | **Settings tab → From number** |
| `<Client> New Lead` (Facebook clients) | New Lead Stuff | **Settings tab → From number** |
| `<Client> Send Message To Contractor …`, `<Client> Fill In Data` | Qualified / New Lead Stuff | Check the Settings tab too — usually none |
| Any other workflow with the client's name | — | Settings tab, and any SMS step whose message starts with `#from:+1…` |

Switch **every** workflow of the client that has a From number — even one
pointing at an older number that no longer exists (owner, 2026-11-26: D and B
New Lead).

For each: click **From number**, type the new number's digits to filter,
pick it, then click **Save** top right (it does **not** save by itself) —
"Saved!" appears. Published workflows stay published — don't touch the
Draft/Publish switch. The rest of a client's workflows (CAPI, Fill In Data,
Send Message To Contractor, Send Appt To Personal Account) had no From number
at Luxury Renovations.

Not this procedure: the **Ready** number in the Gonzalo Zaballa sub-account's
blast workflow (`#from:` inside its SMS text). If the owner wants that cycled
too, ask how — not confirmed yet.

### 6. Check
- Phone System shows exactly two numbers for the client: `1. <Company>` (the
  previously current one) and `2. <Company>` (new).
- Every workflow on your list now shows the new number and is still
  Published.
- Tell the owner the new number is **A2P In Progress** if it still is — texts
  from it may not deliver until it turns Verified.

---

## Report to the owner

Plain and short: which number was deleted, which was kept as `1.`, the new
`2.` number and its monthly price, and the workflows switched to it. Say
anything you couldn't find or weren't sure about.
