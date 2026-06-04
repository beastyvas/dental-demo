-- Migration 006: Add meevo_site_id to clients table
-- Run in Supabase SQL Editor.
--
-- meevo_site_id is the Meevo location identifier for each site.
-- Massage Envy locations each get their own site ID from the Meevo dashboard.
-- Dental clients leave this NULL — it's only used by Meevo-integrated locations.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS meevo_site_id TEXT DEFAULT NULL;

-- Update the Massage Envy Centennial row with its real site ID.
-- Replace 'YOUR_MEEVO_SITE_ID' with the value from the Meevo partner portal.
UPDATE clients
   SET meevo_site_id = 'YOUR_MEEVO_SITE_ID'
 WHERE slug = 'massage-envy-centennial';

-- Example: onboard additional locations like:
-- UPDATE clients SET meevo_site_id = 'SITE_ID_HERE' WHERE slug = 'massage-envy-summerlin';
