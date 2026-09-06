-- Task board: keep the days a task used to sit on, so a past day can still show
-- what was planned there and where it went.
-- Additive only: one array column with an empty default.

alter table tasks add column if not exists prev_dates text[] not null default '{}';
