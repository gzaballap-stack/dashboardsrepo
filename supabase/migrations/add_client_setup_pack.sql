-- Client setup pack (NOTES.md 2026-11-23): what a submitted survey sets up for
-- Facebook on its own — the client's zip codes (company zip + radius) and, for
-- Facebook clients, their copy pack filled in from the active template.
-- Additive and idempotent.

-- The zip codes: { zip, radius, zips[], note, made_at }.
alter table client_surveys add column if not exists audience jsonb;

-- Copy sets: one B2C set is the active template; client packs carry the client.
alter table creative_hub_copy_sets add column if not exists is_template boolean not null default false;
alter table creative_hub_copy_sets add column if not exists active      boolean not null default false;
alter table creative_hub_copy_sets add column if not exists client_id   uuid references clients(id) on delete set null;
create index if not exists creative_hub_copy_sets_client_idx on creative_hub_copy_sets (client_id);
-- Only one active template per scope.
create unique index if not exists creative_hub_copy_sets_active_template_idx
  on creative_hub_copy_sets (scope) where is_template and active;
