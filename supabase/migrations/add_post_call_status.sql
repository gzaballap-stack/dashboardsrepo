-- Post-call outcome of a demo that showed, read from the GoHighLevel contact
-- field "Post-Call Status?" (Close / No Close / Follow Up) by an hourly sync.
-- Stored on the contact's sales_call_shown row.
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS post_call_status text;
