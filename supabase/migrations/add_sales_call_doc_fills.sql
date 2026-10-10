-- Remembers what was last written into each Custom Area Breakdown doc, so a
-- later change to the prospect's numbers can find the old values and swap
-- them for the new ones (Google Docs only does find-and-replace).
CREATE TABLE IF NOT EXISTS sales_call_doc_fills (
  doc_id      text PRIMARY KEY,
  contact_id  text,
  rendered    jsonb NOT NULL DEFAULT '{}'::jsonb,
  filled_at   timestamptz NOT NULL DEFAULT now()
);
