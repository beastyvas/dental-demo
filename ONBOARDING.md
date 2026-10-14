# Onboarding a new client (Answer Desk)

Target: owner call to live line in about an hour.

## One-time setup (already done once, skip after)
1. Run `sql/017_answer_desk.sql` in the Supabase SQL editor.
2. In Vercel → Settings → Environment Variables add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
   `ADMIN_ALERT_PHONE`, `DASHBOARD_URL` (see `.env.example`), then redeploy.
3. In `.env.local` (your machine) add `VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET`, `DEPLOYMENT_URL`,
   `TEMPLATE_ASSISTANT_ID` (the demo assistant is a good template), `TWILIO_*`, `SUPABASE_*`.
4. Twilio → Messaging → Regulatory compliance: register your A2P 10DLC brand + one campaign
   (customer care / mixed). Every client number gets added to it. Approval takes 1+ weeks —
   calls work immediately, texts may be filtered until then.

## Per client (≈ 1 hour)
1. **45-min onboarding call** — fill in `clients/<slug>.json` (copy `clients/example.json`):
   business name, trade (`hvac` · `roofing` · `remodel` · `emergency-trade`), what the AI is
   called, owner name + cell, transfer number, service area, hours, service-call fee, a few
   business facts. Optional: Google Calendar id (share the calendar with the service account).
2. **Preview the script:** `npm run onboard -- <slug> --dry-run` — read it back to the owner.
3. **Go live:** `npm run onboard -- <slug> --buy-number` (or put an existing number in
   `twilio_number` and drop the flag). It creates the assistant, the phone number, the DB row,
   and prints the dashboard password + the forwarding codes.
4. Add the new number to your A2P campaign in Twilio.
5. Owner sets **forward on no-answer/busy** to the new number (codes are printed).
6. Run the 5 test calls the script prints. Send the owner the dashboard link + password.

Changing anything later (hours, fee, transfer number, prompt tweaks): edit the JSON and re-run
`npm run onboard -- <slug>` — it updates in place.

## What the client gets
- Every missed call answered 24/7 with their trade's script, AI + recording disclosure up front
- Emergencies texted to the owner instantly, live transfer on request
- Bookings straight onto their Google Calendar (checked for conflicts), or a callback lead
- A text summary after every real call
- Missed-call text-back when a caller hangs up early or a call drops
- STOP handling, replies forwarded to the owner
- Dashboard: call log with recordings/transcripts, leads captured (the guarantee number),
  minutes used vs plan, and an on/off switch that forwards straight to the owner
