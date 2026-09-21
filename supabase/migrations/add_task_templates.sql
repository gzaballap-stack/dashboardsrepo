-- Task board: weekly Non-Negotiables.
-- A template describes something that must happen every week; the board turns
-- it into ordinary task rows, one per slot. Additive only.

create table if not exists task_templates (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  bucket        text not null default 'A',
  priority      int  not null default 1,
  days          int[] not null default '{}',   -- 1 = Mon … 7 = Sun; empty = any day that week
  count_source  text,                          -- leads | triage | no_shows | no_closes
  position      double precision not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists task_templates_user_idx on task_templates (user_id);

-- The slot a task was generated for. It stays fixed when the task is moved, so
-- a moved or skipped copy is never generated a second time.
alter table tasks add column if not exists template_id   uuid references task_templates(id) on delete set null;
alter table tasks add column if not exists template_date date;

-- Not partial, so it can serve ON CONFLICT; ordinary tasks carry NULLs, which
-- never collide with each other.
create unique index if not exists tasks_template_slot_idx on tasks (template_id, template_date);
