-- Task board: remember where a card came from, so removing it from a day can
-- send it back to its list instead of deleting it.
-- Additive only: one nullable column, backfilled from the existing flag.

alter table tasks add column if not exists origin text;  -- backlog | inbox | null

update tasks set origin = 'backlog' where from_list is true and origin is null;
