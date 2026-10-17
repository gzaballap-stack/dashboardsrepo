-- Which service a client is on: facebook_ads | sms | both. Null = not set yet.
-- Shown and changed on the Client Roster, beside status.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS service text
  CHECK (service IS NULL OR service IN ('facebook_ads', 'sms', 'both'));
