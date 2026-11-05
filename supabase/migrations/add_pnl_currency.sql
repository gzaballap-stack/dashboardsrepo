-- Profit and Loss in euros as well as dollars.
-- Additive only. A line keeps the currency it was typed in and the USD→EUR rate
-- of the day it was entered, so the sheet can be read in either currency
-- without old months moving when the rate does.

ALTER TABLE pnl_lines ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD'
  CHECK (currency IN ('USD', 'EUR'));
ALTER TABLE pnl_lines ADD COLUMN IF NOT EXISTS usd_eur_rate numeric;   -- EUR per 1 USD when entered
