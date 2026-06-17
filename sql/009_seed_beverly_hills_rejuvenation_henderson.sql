-- Seed: Beverly Hills Rejuvenation Center - Henderson, NV
-- Run in Supabase SQL Editor AFTER 007_add_calendar_id_to_clients.sql has been run.
-- NEVER commit real passwords or phone numbers to git.

INSERT INTO clients (slug, business_name, agent_id, dashboard_password, doctor_phone, front_desk_phone, timezone)
VALUES (
  'bhrc-henderson',
  'Beverly Hills Rejuvenation Center - Henderson',
  'aeec7c93-00d7-4c4a-96fe-8568d92113ea',
  '120',
  '7024289920',
  '7024289920',
  'America/Los_Angeles'
)
ON CONFLICT (slug) DO UPDATE SET
  agent_id           = EXCLUDED.agent_id,
  business_name      = EXCLUDED.business_name,
  dashboard_password = EXCLUDED.dashboard_password;
