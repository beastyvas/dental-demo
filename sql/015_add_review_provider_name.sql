-- Add an optional "provider name" to clients, shown in the review-request SMS
-- so the patient/client knows who to credit in their Google review
-- (e.g. a specific stylist/esthetician at a school or salon, rather than
-- just the business name).
-- Run in Supabase SQL Editor AFTER 002_create_clients_table.sql has been run.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS review_provider_name TEXT DEFAULT NULL;
