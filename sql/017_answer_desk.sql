-- Answer Desk: per-client phone setup, call log, SMS log, opt-outs.
-- Run in Supabase SQL Editor AFTER 016_add_assistant_active.sql.
-- Safe to run more than once.

-- ── clients: everything onboarding needs to wire a trade client ────────────
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS trade                 TEXT,          -- hvac | roofing | remodel | emergency-trade
  ADD COLUMN IF NOT EXISTS agent_name            TEXT,          -- what the receptionist calls itself
  ADD COLUMN IF NOT EXISTS owner_phone           TEXT,          -- gets call summaries + urgent alerts (falls back to doctor_phone)
  ADD COLUMN IF NOT EXISTS transfer_phone        TEXT,          -- live transfers + where calls go when the AI is switched off
  ADD COLUMN IF NOT EXISTS twilio_number         TEXT,          -- the AI line, E.164; texts go out from here too
  ADD COLUMN IF NOT EXISTS twilio_number_sid     TEXT,
  ADD COLUMN IF NOT EXISTS vapi_phone_number_id  TEXT,
  ADD COLUMN IF NOT EXISTS service_area          TEXT,
  ADD COLUMN IF NOT EXISTS business_hours        JSONB,         -- {"mon":["07:00","17:00"],...,"sun":null}; null = Mon–Fri 8–5
  ADD COLUMN IF NOT EXISTS plan                  TEXT,          -- answer_desk | booked_jobs | full_office
  ADD COLUMN IF NOT EXISTS included_minutes      INTEGER;

-- Trade clients have no "doctor" — let new rows leave the dental columns empty.
ALTER TABLE clients ALTER COLUMN doctor_phone     DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN front_desk_phone DROP NOT NULL;

-- ── calls: one row per Vapi call (written by /api/vapi/events) ─────────────
CREATE TABLE IF NOT EXISTS calls (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID        REFERENCES clients(id) ON DELETE SET NULL,
  vapi_call_id      TEXT        NOT NULL UNIQUE,
  caller_phone      TEXT,
  caller_name       TEXT,
  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  duration_seconds  INTEGER,
  ended_reason      TEXT,
  outcome           TEXT,       -- booked | lead | emergency | transferred | hangup | spam | error | info
  summary           TEXT,
  need              TEXT,
  transcript        TEXT,
  recording_url     TEXT,
  after_hours       BOOLEAN     NOT NULL DEFAULT FALSE,
  owner_notified    BOOLEAN     NOT NULL DEFAULT FALSE,
  text_back_sent    BOOLEAN     NOT NULL DEFAULT FALSE,
  cost              NUMERIC(10,4),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calls_client_started ON calls (client_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_caller         ON calls (client_id, caller_phone);

-- ── messages: every text we send or receive ───────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID        REFERENCES clients(id) ON DELETE SET NULL,
  direction   TEXT        NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  from_number TEXT,
  to_number   TEXT,
  body        TEXT,
  kind        TEXT,       -- owner_summary | text_back | emergency | review | reply | admin_alert | other
  twilio_sid  TEXT,
  status      TEXT,
  call_id     UUID        REFERENCES calls(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_client_created ON messages (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_to_kind        ON messages (to_number, kind, created_at DESC);

-- ── opt_outs: STOP replies. Checked before every outbound text. ─────────────
CREATE TABLE IF NOT EXISTS opt_outs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID        REFERENCES clients(id) ON DELETE CASCADE,
  phone       TEXT        NOT NULL,   -- E.164
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, phone)
);

-- ── waitlist: link each lead/booking to the call that produced it ──────────
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS vapi_call_id TEXT;
CREATE INDEX IF NOT EXISTS idx_waitlist_vapi_call ON waitlist (vapi_call_id);

-- Same lock-down as the other tables: only the service role touches these.
ALTER TABLE calls    ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE opt_outs ENABLE ROW LEVEL SECURITY;
