-- Hammond Dental — Waitlist Table
-- Run once in Supabase SQL Editor (not Table Editor — that connection is read-only).
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS guards.

CREATE TABLE IF NOT EXISTS waitlist (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_name    TEXT        NOT NULL,
  phone           TEXT        NOT NULL,
  preferred_days  TEXT,
  preferred_times TEXT,
  service_needed  TEXT        NOT NULL,
  priority        TEXT        NOT NULL DEFAULT 'routine'
                              CHECK (priority IN ('routine', 'urgent')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  contacted       BOOLEAN     NOT NULL DEFAULT FALSE
);

-- Indexes for common dashboard + cron queries
CREATE INDEX IF NOT EXISTS idx_waitlist_contacted   ON waitlist (contacted);
CREATE INDEX IF NOT EXISTS idx_waitlist_priority    ON waitlist (priority);
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at  ON waitlist (created_at DESC);

-- Row Level Security (service-role key bypasses this automatically)
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "service role full access" ON waitlist
  USING (TRUE)
  WITH CHECK (TRUE);
