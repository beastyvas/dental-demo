-- Adds review_only_dashboard flag to clients table.
-- When true, the client's dashboard login shows a stripped-down, dedicated
-- review-request page instead of the standard leads/waitlist dashboard.
-- Used for clients who only use the Review Funnel (no AI voice receptionist).
--
-- Run in Supabase SQL Editor AFTER 010_add_review_funnel_to_clients.sql.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS review_only_dashboard boolean DEFAULT false;
