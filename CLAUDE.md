# Call Center Reporting Dashboard

## What This Is

A reporting dashboard for a call center or setter team. Tracks dials, leads,
appointments, shows, no-shows, and ad spend across all lead sources.

**Data pipeline:** GHL → Make.com → Railway (this app) → Supabase → Dashboard

---

## First Time Setup

If you haven't set this up yet, fill in `.env.local` with your API keys
and run `/start` — Claude will build everything automatically.

---

## Folder Structure

```
/
├── CLAUDE.md                        ← You are here
├── .env.local                       ← Your API keys (never share this)
├── .claude/commands/start.md        ← The /start setup skill
│
├── make-blueprints/                 ← Make.com scenario blueprints
├── supabase/
│   └── schema.sql                   ← Full database schema (run once)
│
└── src/
    ├── app/
    │   ├── api/                     ← All API routes (webhooks, metrics, etc.)
    │   ├── dashboard/               ← Dashboard page
    │   ├── setup/                   ← First-run admin account creation
    │   └── login/                   ← Login page
    └── components/                  ← UI components
        ├── DashboardView.tsx        ← Main dashboard (nav + all views)
        ├── UserManager.tsx          ← Admin → Users tab
        ├── SetterSchedule.tsx       ← Power dialer schedule
        └── ClientRoster.tsx         ← Lead source management
```

---

## Key Files

| Task | File |
|------|------|
| First-run admin setup | `src/app/setup/page.tsx` (visit `/setup`) |
| User management (add/remove) | `src/components/UserManager.tsx` |
| Webhook ingestion | `src/app/api/webhooks/route.ts` |
| Metrics calculation | `src/lib/metrics.ts` |
| Dashboard UI | `src/components/DashboardView.tsx` |
| Database schema | `supabase/schema.sql` |
| Environment variables | `.env.local` |
