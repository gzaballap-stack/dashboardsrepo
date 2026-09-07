-- Health Tracker — diet plan + gym split, alongside the weekly log.
-- Additive only: two nullable jsonb columns on the existing per-user settings row.

alter table lift_settings add column if not exists diet_plan  jsonb not null default '{}'::jsonb;
alter table lift_settings add column if not exists split_plan jsonb not null default '{}'::jsonb;
