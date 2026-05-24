-- Seed: Massage Envy Centennial
-- Run in Supabase SQL Editor AFTER 002_create_clients_table.sql has been run.
-- NEVER commit real passwords or phone numbers to git.

INSERT INTO clients (slug, business_name, agent_id, dashboard_password, doctor_phone, front_desk_phone, timezone)
VALUES (
  'massage-envy-centennial',
  'Massage Envy Centennial',
  '4235062a-715a-49fe-a72f-9ef83c915b35',
  'me1234',
  '7026892403',   -- GF's number — manager emergency SMS + morning summary
  '7026892403',   -- same for now; split when onboarding real staff
  'America/Los_Angeles'
)
ON CONFLICT (slug) DO NOTHING;
