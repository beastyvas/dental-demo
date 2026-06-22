-- Lets a business pause their AI receptionist from the dashboard.
-- When false, checkOfficeHours tells the assistant to transfer the
-- caller to the front desk instead of running the normal call flow.
-- Run in Supabase SQL Editor AFTER 002_create_clients_table.sql.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS assistant_active boolean NOT NULL DEFAULT true;
