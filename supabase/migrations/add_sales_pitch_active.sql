-- Sales Tracker — pitches are a catalogue, not just the current list.
-- Un-ticking a pitch hides it from the By pricing panel; it stays in the
-- catalogue and in every call that used it. Additive: one new column.
alter table sales_pitches add column if not exists active boolean not null default true;
