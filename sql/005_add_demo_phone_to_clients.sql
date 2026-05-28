-- Add demo_phone to clients table.
-- This is the Vapi phone number callers dial to reach the AI receptionist.
-- Shown in the client dashboard welcome bar so prospects can test it live.
-- Run in Supabase SQL Editor.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS demo_phone TEXT;
