-- ABCDE Task Board — day / week scheduling
-- Additive only: new columns on `tasks`, backfilled from created_at.

alter table tasks add column if not exists task_date date;
alter table tasks add column if not exists scope text not null default 'day';  -- day | week

update tasks set task_date = created_at::date where task_date is null;

alter table tasks alter column task_date set default current_date;

create index if not exists tasks_user_scope_date_idx on tasks (user_id, scope, task_date);
