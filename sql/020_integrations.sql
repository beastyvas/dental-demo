-- Job-software connections (Jobber OAuth tokens, Housecall Pro) per client.
-- { "jobber": { "account_id", "account_name", "access_token", "refresh_token", "expires_at" } }
-- Run AFTER 019_lead_inbox.sql. Safe to run more than once.
-- Mirrored in the CRM repo: supabase/migrations/2026-10-28_integrations.sql.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS integrations JSONB NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_clients_jobber_account ON clients ((integrations -> 'jobber' ->> 'account_id'));
