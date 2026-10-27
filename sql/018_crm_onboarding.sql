-- CRM-driven onboarding: a clients row now starts life when the deal closes in
-- the CRM (status 'onboarding', no assistant yet) and is filled in, provisioned
-- and taken live from there. See lib/provision.js and /api/admin/:action.
-- Run in Supabase SQL Editor AFTER 017_answer_desk.sql. Safe to run more than once.
--
-- Once the receptionist moves onto the CRM's database, the CRM migration
-- supabase/migrations/2026-10-27_customers.sql supersedes this file (and adds
-- the foreign key from clients.lead_id to leads.id).

-- Rows created at close have no Vapi assistant or password until provisioning.
ALTER TABLE clients ALTER COLUMN agent_id           DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN dashboard_password DROP NOT NULL;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS lead_id             UUID,                          -- the CRM lead this customer came from
  ADD COLUMN IF NOT EXISTS status              TEXT  NOT NULL DEFAULT 'live', -- onboarding | live | paused | cancelled
  ADD COLUMN IF NOT EXISTS config              JSONB,                         -- the onboarding form (was clients/<slug>.json)
  ADD COLUMN IF NOT EXISTS onboarding_steps    JSONB NOT NULL DEFAULT '{}',   -- { provisioned: { done, at }, a2p: ..., ... }
  ADD COLUMN IF NOT EXISTS setup_fee           NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS mrr                 NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS provisioned_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at          TIMESTAMPTZ,                   -- went live (billing start)
  ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_token        TEXT,                          -- owner's self-serve intake link
  ADD COLUMN IF NOT EXISTS intake_submitted_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE clients ADD CONSTRAINT clients_status_check
    CHECK (status IN ('onboarding', 'live', 'paused', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_lead_id      ON clients (lead_id)      WHERE lead_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_intake_token ON clients (intake_token) WHERE intake_token IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_clients_status       ON clients (status);
