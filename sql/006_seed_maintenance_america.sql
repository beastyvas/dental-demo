-- Seed: Maintenance America
-- Run in Supabase SQL Editor AFTER 002_create_clients_table.sql has been run.

INSERT INTO clients (slug, business_name, agent_id, dashboard_password, doctor_phone, front_desk_phone, timezone)
VALUES (
  'maintenance-america',
  'Maintenance America',
  '2016b703-41c0-4b5d-8505-5bc5bcf17cf3',
  '3065',
  '7027209838',
  '7027209838',
  'America/Los_Angeles'
)
ON CONFLICT (slug) DO NOTHING;
