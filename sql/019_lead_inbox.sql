-- Lead inbox + automations: every lead (phone, website form, Angi/Thumbtack/
-- Facebook lead emails, reactivation lists) lands in client_leads; every
-- scheduled text (estimate follow-ups, reminders, review requests,
-- reactivation) is a followups row the cron sends when it's due.
-- Run AFTER 018_crm_onboarding.sql. Safe to run more than once.
-- Mirrored in the CRM repo: supabase/migrations/2026-10-28_lead_inbox.sql.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS lead_key   TEXT,   -- secret in webhook URLs + the lead email address
  ADD COLUMN IF NOT EXISTS automation JSONB;  -- toggles + message templates (lib/automation.js defaults)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_lead_key ON clients (lead_key) WHERE lead_key IS NOT NULL;

-- A booking's real start time — reminders are scheduled off it.
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS appointment_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS client_leads (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source            TEXT        NOT NULL,   -- call | form | email | angi | thumbtack | meta | reactivation | manual | jobber | hcp
  name              TEXT,
  phone             TEXT,                   -- E.164
  email             TEXT,
  message           TEXT,
  raw               JSONB,                  -- the original payload, for reprocessing
  status            TEXT        NOT NULL DEFAULT 'new'
                                CHECK (status IN ('new', 'contacted', 'replied', 'estimate_sent', 'booked', 'job_done', 'won', 'lost')),
  appointment_at    TIMESTAMPTZ,
  external_id       TEXT,                   -- Jobber / Housecall Pro id
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_response_at TIMESTAMPTZ,            -- speed-to-lead clock stops here
  vapi_call_id      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_leads_client   ON client_leads (client_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_leads_phone    ON client_leads (client_id, phone);
CREATE INDEX IF NOT EXISTS idx_client_leads_external ON client_leads (client_id, external_id);

CREATE TABLE IF NOT EXISTS followups (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  lead_id     UUID        REFERENCES client_leads(id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL CHECK (kind IN ('estimate', 'reminder', 'review', 'reactivation')),
  step        INTEGER     NOT NULL DEFAULT 1,
  to_phone    TEXT        NOT NULL,
  body        TEXT,                    -- null for review (built at send time)
  send_at     TIMESTAMPTZ NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'sent', 'cancelled', 'failed', 'skipped')),
  sent_at     TIMESTAMPTZ,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_followups_due   ON followups (send_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_followups_lead  ON followups (lead_id);
CREATE INDEX IF NOT EXISTS idx_followups_phone ON followups (client_id, to_phone) WHERE status = 'pending';

-- Service role only (no policies).
ALTER TABLE client_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE followups    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON client_leads, followups FROM anon, authenticated;
