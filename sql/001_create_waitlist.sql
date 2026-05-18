-- Feature 1: Waitlist/Callback System
-- Run this in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS waitlist (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_name  TEXT NOT NULL,
  phone         TEXT NOT NULL,
  preferred_days  TEXT,
  preferred_times TEXT,
  service_needed  TEXT NOT NULL,
  priority      TEXT NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent')),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  contacted     BOOLEAN NOT NULL DEFAULT FALSE
);

-- Index for common dashboard queries
CREATE INDEX IF NOT EXISTS idx_waitlist_contacted   ON waitlist (contacted);
CREATE INDEX IF NOT EXISTS idx_waitlist_priority    ON waitlist (priority);
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at  ON waitlist (created_at DESC);

-- Enable Row Level Security (required for Supabase service-role usage)
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Service-role key bypasses RLS — this policy covers anon/authenticated reads
-- for the dashboard (swap to a proper auth policy once you add Supabase Auth)
CREATE POLICY "service role full access" ON waitlist
  USING (TRUE)
  WITH CHECK (TRUE);
