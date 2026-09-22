-- Task board: sales calls from the connected calendar appear among the
-- non-negotiables so they can be ticked off. Each call becomes a task row keyed
-- on its calendar event, so re-syncing never duplicates it. Additive only.

alter table tasks add column if not exists external_key text;   -- cal:<event uid>:<start>
alter table tasks add column if not exists starts_at timestamptz;

-- Not partial, so it can serve ON CONFLICT; other rows carry NULL, which never collide.
create unique index if not exists tasks_external_key_idx on tasks (external_key);
