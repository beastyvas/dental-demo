-- Adds the Review Funnel feature flag + Google review link per client.
-- Hidden/no-op for any client until review_funnel_enabled is set to true.
--
-- Run in Supabase SQL Editor AFTER 002_create_clients_table.sql.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS review_funnel_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_review_link    text    DEFAULT null;
