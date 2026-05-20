-- Add client_id FK to waitlist for multi-tenant support.
-- Run AFTER 002_create_clients_table.sql.
-- Nullable so existing rows aren't broken.

ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_waitlist_client_id ON waitlist (client_id);

-- Backfill existing Hammond Dental rows after seeding the clients table:
--   UPDATE waitlist
--   SET    client_id = (SELECT id FROM clients WHERE slug = 'hammond-dental')
--   WHERE  client_id IS NULL;
