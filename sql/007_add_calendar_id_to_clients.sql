-- Adds a Google Calendar ID per client, so bookings can sync to a real
-- calendar in addition to the dashboard waitlist.
--
-- To get a calendar ID:
--   1. In Google Calendar, create (or pick) the calendar for this business.
--   2. Settings > Integrate calendar > "Calendar ID"
--      (your own calendar's ID is your email address; a dedicated calendar's
--      ID ends in @group.calendar.google.com).
--   3. Settings > Share with specific people > add the service account's
--      client_email (from the GOOGLE_SERVICE_ACCOUNT_KEY JSON, looks like
--      ...@...iam.gserviceaccount.com) with "Make changes to events".
--
-- Run in Supabase SQL Editor AFTER 002_create_clients_table.sql.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS calendar_id TEXT;

-- Maintenance America — replace with the real calendar ID before the demo.
UPDATE clients
SET calendar_id = 'REPLACE_WITH_CALENDAR_ID'
WHERE slug = 'maintenance-america';
