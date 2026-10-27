-- Per-client A2P 10DLC registration state (lib/a2p.js): business info, Twilio
-- SIDs (customer profile, trust product, brand, messaging service, campaign)
-- and status. Run AFTER 021_sites.sql. Safe to run more than once.
-- Mirrored in the CRM repo: supabase/migrations/2026-10-28_a2p.sql.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS a2p JSONB;
