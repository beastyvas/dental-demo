-- Multi-tenant: clients table
-- Each row = one paying client (dental office, HVAC company, etc.)
-- Run in Supabase SQL Editor BEFORE running 003_add_client_id_to_waitlist.sql

CREATE TABLE IF NOT EXISTS clients (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT        NOT NULL UNIQUE,           -- "hammond-dental"
  business_name       TEXT        NOT NULL,                  -- "Hammond Dental"
  agent_id            TEXT        NOT NULL UNIQUE,           -- Vapi assistant ID
  dashboard_password  TEXT        NOT NULL,                  -- plain-text (no PII risk)
  doctor_phone        TEXT        NOT NULL,                  -- emergency SMS target
  front_desk_phone    TEXT        NOT NULL,                  -- morning summary SMS target
  timezone            TEXT        NOT NULL DEFAULT 'America/Los_Angeles',
  active              BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_agent_id ON clients (agent_id);
CREATE INDEX IF NOT EXISTS idx_clients_active   ON clients (active);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role full access" ON clients;
CREATE POLICY "service role full access" ON clients
  USING (TRUE)
  WITH CHECK (TRUE);

-- ── Seed row: Hammond Dental ────────────────────────────────────────────────
-- Replace placeholder values with real data before running.
-- NEVER commit real passwords or phone numbers to git.
INSERT INTO clients (slug, business_name, agent_id, dashboard_password, doctor_phone, front_desk_phone, timezone)
VALUES (
  'hammond-dental',
  'Hammond Dental',
  'YOUR_VAPI_AGENT_ID',          -- e.g. 54da6a88-1e1e-4977-a216-1670b689a253
  'YOUR_DASHBOARD_PASSWORD',     -- was in DASHBOARD_PASSWORD env var
  'YOUR_DOCTOR_PHONE',           -- was in DOCTOR_EMERGENCY_PHONE env var
  'YOUR_FRONT_DESK_PHONE',       -- was in FRONT_DESK_PHONE env var
  'America/Los_Angeles'
)
ON CONFLICT (slug) DO NOTHING;
