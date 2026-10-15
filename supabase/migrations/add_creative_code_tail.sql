-- Creative & Copy Hub: a creative's code can be typed by hand. code_tail holds
-- the last part of the code when it was set manually (null = automatic: the
-- running number, or H#B# for talking heads). Additive only.
alter table creative_hub_entries add column if not exists code_tail text;
