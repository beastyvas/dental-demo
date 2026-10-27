-- Client websites: content + custom domain, rendered by api/site.js.
-- { "published", "headline", "subhead", "about", "services": [{ "name", "blurb" }],
--   "areas": [], "reviews": [{ "name", "text" }], "photos": [], "color", "license", "domain" }
-- Run AFTER 020_integrations.sql. Safe to run more than once.
-- Mirrored in the CRM repo: supabase/migrations/2026-10-28_sites.sql.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS site JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_site_domain ON clients ((site ->> 'domain')) WHERE site ->> 'domain' IS NOT NULL;
