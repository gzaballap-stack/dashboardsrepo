-- Lead postal code on events.
--
-- Zip performance used to be typed in by hand (zip_performance rows). With a zip
-- stamped on each event, leads / appointments / shows / closes roll up into the
-- zips a client actually targets on their own — and, because events already carry
-- ad attribution, each zip can be broken down by the ad or creative that produced
-- it.
--
-- Backfill-free: existing rows stay null, and every read falls back to the stored
-- zip_performance numbers for any zip with no event zips yet.

ALTER TABLE events ADD COLUMN IF NOT EXISTS zip_code text;

CREATE INDEX IF NOT EXISTS events_client_zip
  ON events (client_id, zip_code)
  WHERE zip_code IS NOT NULL;
