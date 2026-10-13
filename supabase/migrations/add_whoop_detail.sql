-- Whoop: steps, bed and wake times, sleep cycles and disturbances. Additive.
-- Workout detail (calories, distance, altitude, heart-rate zones) lives inside
-- the existing `workouts` jsonb and needs no column.
alter table whoop_days add column if not exists steps           integer;
alter table whoop_days add column if not exists bed_time_local  text;      -- "23:12", in the user's own zone that night
alter table whoop_days add column if not exists wake_time_local text;      -- "06:40"
alter table whoop_days add column if not exists sleep_cycles    integer;
alter table whoop_days add column if not exists disturbances    integer;
