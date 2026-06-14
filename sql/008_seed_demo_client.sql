-- Seed: Demo (generic, vertical-adaptive demo agent)
-- Run in Supabase SQL Editor AFTER 007_add_calendar_id_to_clients.sql has been run.
--
-- This is the single shared "demo agent" — at the start of each call it
-- asks the caller what type of business to represent, then adapts. All
-- demo bookings land on Nick's personal Google calendar (calendar_id below),
-- which must be shared with the service account's client_email
-- ("Make changes to events" permission) for sync to work.

INSERT INTO clients (slug, business_name, agent_id, dashboard_password, doctor_phone, front_desk_phone, timezone, calendar_id)
VALUES (
  'demo',
  'Live Demo',
  '73ce919c-a2f9-420e-bb7f-323a79fdac69',
  'demo2026',
  '7027209838',
  '7027209838',
  'America/Los_Angeles',
  'vasquezjrnick@gmail.com'
)
ON CONFLICT (slug) DO UPDATE SET
  agent_id      = EXCLUDED.agent_id,
  calendar_id   = EXCLUDED.calendar_id,
  business_name = EXCLUDED.business_name;
