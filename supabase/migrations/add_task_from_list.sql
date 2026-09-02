-- Task board: items scheduled out of the long-term to-do list stay on that list
-- until they're actually ticked off.
alter table tasks add column if not exists from_list boolean not null default false;
