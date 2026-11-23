# Cycling a Client's Phone Number — Playbook

Self-contained instructions for replacing the phone number a client's texts are
sent from, without breaking conversations already in progress. Companion to
`ONBOARDING.md` (read its Section 1 rules and Section 2 "where things are"
first). Written 2026-11-23 from the owner's description; the GHL screens for
deleting a number have not been walked through yet — check on screen and fix
this file the first time it is run.

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

---

## Steps

### 1. Delete the OLD number (`1. <Company>`)
Owner's yes first (Rule 2). Phone System → the `1. <Company>` row → its menu →
Delete / Release. Confirm.

### 2. Rename CURRENT from `2.` to `1.`
Phone System → pencil next to `2. <Company>` → Friendly name
`1. <Company>` → Save. Change nothing else.

### 3. Buy the NEW number, named `2. <Company>`
Same as `ONBOARDING.md` 7.2:
1. Phone System → Add Number → Add Phone Number → Filter → the client's
   **area code** (from their address zip), Match To **First part of number** →
   Apply.
2. Owner's yes (Rule 1) → buy.

### 4. Give the NEW number the same settings
Pencil next to the new number:
- Friendly name `2. <Company>`.
- **Call Recording on**, then **untick "Call recording message"** (it ticks
  itself).
- Advanced Settings → tick **Whisper Message** → replace the whole box with
  `{{contact.client_name}}` (the picker inserts `undefined …` — remove it).
- Anything else the old number had (compare with the renamed `1. <Company>`
  side by side, e.g. call forwarding). Save.

### 5. Switch every workflow from the old number to the NEW number
Ultimate → Automation → workflows. Search the client's name. A client's
sending number can be in:

| Workflow | Folder | Where the number is |
|---|---|---|
| `SMS: <Client> Appointment Confirmed` | SMS Stuff → SMS Client Folder | **Settings tab → Sender details → From number** |
| `SMS: <Client> No Response` | same | **Settings tab → From number** |
| `<Client> New Lead` (Facebook clients) | New Lead Stuff | **Settings tab → From number** |
| `<Client> Send Message To Contractor …`, `<Client> Fill In Data` | Qualified / New Lead Stuff | Check the Settings tab too — usually none |
| Any other workflow with the client's name | — | Settings tab, and any SMS step whose message starts with `#from:+1…` |

For each: set **From number** to the NEW `2. <Company>` number (it saves by
itself on the Settings tab; if you changed a step, click **Save** top right).
Published workflows stay published — don't touch the Draft/Publish switch.

Not this procedure: the **Ready** number in the Gonzalo Zaballa sub-account's
blast workflow (`#from:` inside its SMS text). If the owner wants that cycled
too, ask how — not confirmed yet.

### 6. Check
- Phone System shows exactly two numbers for the client: `1. <Company>` (the
  previously current one) and `2. <Company>` (new).
- Every workflow on your list now shows the new number.

---

## Report to the owner

Plain and short: which number was deleted, which was kept as `1.`, the new
`2.` number and its monthly price, and the workflows switched to it. Say
anything you couldn't find or weren't sure about.
