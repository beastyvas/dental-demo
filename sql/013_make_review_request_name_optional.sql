-- The review-only dashboard lets the business owner send a review request
-- with just a phone number — they often don't know the customer's name.
-- Run in Supabase SQL Editor AFTER 011_create_review_requests.sql.

ALTER TABLE review_requests
  ALTER COLUMN patient_name DROP NOT NULL;
