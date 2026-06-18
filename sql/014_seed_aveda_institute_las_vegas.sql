-- Seed: Aveda Institute Las Vegas (review-only dashboard — no voice agent)
-- Run in Supabase SQL Editor AFTER 012_add_review_only_dashboard.sql,
-- 013_make_review_request_name_optional.sql, and
-- 015_add_review_provider_name.sql have been run.
-- NEVER commit real passwords or phone numbers to git.

INSERT INTO clients (
  slug, business_name, agent_id, dashboard_password,
  doctor_phone, front_desk_phone, timezone,
  review_funnel_enabled, review_only_dashboard, google_review_link,
  review_provider_name
)
VALUES (
  'aveda-institute-las-vegas',
  'Aveda Institute Las Vegas',
  'review-only-aveda-institute-las-vegas',  -- placeholder: no real Vapi agent, just satisfies NOT NULL UNIQUE
  '8888',
  '7026892403',
  '7026892403',
  'America/Los_Angeles',
  true,
  true,
  NULL,  -- TODO: paste her Google review link here once she grabs it from
         -- Google Business Profile (Home -> "Get more reviews" -> Share),
         -- then: UPDATE clients SET google_review_link = '...'
         -- WHERE slug = 'aveda-institute-las-vegas';
  'Arianna Destiny'  -- review SMS asks clients to mention Arianna Destiny by name — testimonials for her, not just the school
)
ON CONFLICT (slug) DO UPDATE SET
  dashboard_password    = EXCLUDED.dashboard_password,
  review_funnel_enabled = EXCLUDED.review_funnel_enabled,
  review_only_dashboard = EXCLUDED.review_only_dashboard,
  review_provider_name  = EXCLUDED.review_provider_name;
