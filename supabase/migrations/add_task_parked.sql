-- Task board: let an unfinished task be left behind on its day on purpose, so it
-- stops appearing in the catch-up prompt without being completed or deleted.
-- Additive only.

alter table tasks add column if not exists parked boolean not null default false;
