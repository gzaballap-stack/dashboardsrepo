-- Whoop sleep need and sleep debt. Additive: two nullable columns on whoop_days.
alter table whoop_days add column if not exists sleep_need_hours numeric;   -- how much Whoop said you needed that night
alter table whoop_days add column if not exists sleep_debt_hours numeric;   -- the part of that need that was carried-over debt
