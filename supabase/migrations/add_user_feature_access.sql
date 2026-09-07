-- Per-user feature access.
-- Additive only: one new column on `profiles`.
--
-- Backfilled to NULL-means-everything for every account that already exists, so
-- nobody loses access on deploy. Access is only ever narrowed by an admin
-- explicitly setting a list in Settings > Users.

alter table profiles add column if not exists allowed_views text[];
