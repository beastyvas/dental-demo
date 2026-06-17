-- Review Funnel — tracks each review-request SMS sent to a patient/client,
-- and whether/how they responded.
-- Run in Supabase SQL Editor AFTER 010_add_review_funnel_to_clients.sql.

CREATE TABLE IF NOT EXISTS review_requests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID        NOT NULL REFERENCES clients(id),
  patient_name  TEXT        NOT NULL,
  patient_phone TEXT        NOT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clicked       BOOLEAN     NOT NULL DEFAULT FALSE,
  rating        SMALLINT    CHECK (rating BETWEEN 1 AND 5),
  feedback      TEXT
);

CREATE INDEX IF NOT EXISTS idx_review_requests_client_id ON review_requests (client_id);
CREATE INDEX IF NOT EXISTS idx_review_requests_sent_at   ON review_requests (sent_at DESC);

ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role full access" ON review_requests;
CREATE POLICY "service role full access" ON review_requests
  USING (TRUE)
  WITH CHECK (TRUE);
