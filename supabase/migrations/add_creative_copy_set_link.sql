-- A creative carries a copy set (the combination of texts it runs with)
-- rather than its own headline / primary text. Additive only.
alter table creative_hub_entries add column if not exists copy_set_id uuid references creative_hub_copy_sets(id) on delete set null;
create index if not exists creative_hub_entries_copy_set_idx on creative_hub_entries (copy_set_id);
