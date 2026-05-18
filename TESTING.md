# Testing Checklist — Hammond Dental AI Receptionist

Use this script before pitching to a real client.
Run every test in order. Check each box before moving on.

---

## Pre-flight: Environment

- [ ] Supabase: ran `sql/001_create_waitlist.sql` — table exists in Table Editor
- [ ] Vercel: all env vars set (compare against `.env.example`)
- [ ] Vapi: 3 tools added — `checkOfficeHours`, `addToWaitlist`, `sendEmergencyAlert`
- [ ] Vapi: `rachel-system-prompt.md` pasted into System Prompt (everything after `===START===`)
- [ ] Vapi: `YOUR_VERCEL_DOMAIN` replaced in all 3 tool JSON files
- [ ] Vapi: `VAPI_WEBHOOK_SECRET` matches in Vercel env + tool headers
- [ ] Twilio: `DOCTOR_EMERGENCY_PHONE` and `FRONT_DESK_PHONE` are real numbers you can receive texts on

---

## Feature 1 — Waitlist

### Test A: Routine appointment request
**Call script:**
> "Hi, I'd like to schedule a teeth cleaning."

Expected behavior:
- [ ] Rachel says she's booked ~4 weeks out
- [ ] Rachel offers to add you to the cancellation list
- [ ] Rachel collects: name, phone, service, preferred days, preferred times
- [ ] Rachel confirms details back to you before saving
- [ ] Rachel says "You're all set"
- [ ] Supabase → Table Editor → `waitlist` → new row appears
- [ ] Row has `priority = routine`, `contacted = false`

### Test B: Caller declines waitlist
**Call script:**
> "I'd like a cleaning." → when offered waitlist → "No thanks."

Expected behavior:
- [ ] Rachel thanks them and doesn't push further
- [ ] No row created in Supabase

---

## Feature 2 — Emergency Triage

### Test C: Emergency caller (any time)
**Call script:**
> "I'm in severe pain — my tooth has been throbbing all night and I can't sleep."

Expected behavior:
- [ ] Rachel immediately shifts to urgent/empathetic tone
- [ ] Rachel does NOT proceed as if it's a routine call
- [ ] Rachel collects: name, phone, description of emergency
- [ ] Supabase → new row with `priority = urgent`
- [ ] `DOCTOR_EMERGENCY_PHONE` receives an SMS within ~10 seconds

**Verify SMS content:**
```
🚨 URGENT — Emergency patient call:
Patient: [name you gave]
Phone: [number you gave]
Issue: [what you described]
Called at: [Las Vegas time, showing 2026]
Call them back ASAP.
```

- [ ] Timestamp shows correct Las Vegas time (not UTC)
- [ ] Year shows 2026

### Test D: Additional emergency keywords
Run quick tests for each keyword group — Rachel should shift tone immediately:
- [ ] "broken tooth"
- [ ] "swollen jaw"
- [ ] "knocked out tooth"
- [ ] "lost my crown"
- [ ] "won't stop bleeding"

---

## Feature 3 — Morning Summary

### Test E: Manual cron trigger
From terminal, trigger the cron manually:
```bash
curl -X GET https://YOUR_VERCEL_DOMAIN.vercel.app/api/cron/morning-summary \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Expected behavior:
- [ ] `FRONT_DESK_PHONE` receives a summary SMS
- [ ] SMS lists entries from last 24 hours, grouped by routine/urgent
- [ ] Entries that were uncontacted → `contacted = true` in Supabase after send
- [ ] If no entries: receives "No overnight entries" message

**Verify SMS format matches spec:**
- [ ] Shows count of routine waitlist additions
- [ ] Shows count of emergencies (if any) with "Already alerted at [time]"
- [ ] Times shown in Las Vegas local time
- [ ] Ends with "Have a great day! — AI Receptionist"

### Test F: Scheduled cron (production)
- [ ] In Vercel dashboard → Cron Jobs, confirm job appears: `0 15 * * 1-6`
- [ ] On a weekday, verify it fires at 8:00 AM Las Vegas time
  (Note: during standard time Nov–Mar, 8am PST = 16:00 UTC — update schedule if needed)

---

## Feature 4 — After Hours Mode

### Test G: Call during business hours (Mon–Fri 8am–5pm LV time)
**Call script:**
> "Hi, I need an appointment."

Expected behavior:
- [ ] Rachel uses business-hours greeting: "Thank you for calling Hammond Dental, this is Rachel speaking..."
- [ ] Tone is "we're with patients" / normal reception mode

### Test H: Call after hours (evenings/weekends)
To test without waiting for real after-hours:
- Temporarily comment out the `isWeekday && inHours` check in `lib/businessHours.js` and force `isOpen = false`
- Or call on a weekend

Expected behavior:
- [ ] Rachel uses after-hours greeting: "Our office is currently closed..."
- [ ] Rachel mentions she can still help schedule or handle emergencies
- [ ] Waitlist flow still works (entries still save to Supabase)

### Test I: Holiday detection
Add a test date to `lib/businessHours.js` (e.g., temporarily add today's date to the holidays array):

Expected behavior:
- [ ] Rachel uses the holiday message
- [ ] Offers to take info for next business day callback

### Test J: Date/year sanity check
**Call script:**
> "What year is it?" or "When's the next available appointment?"

Expected behavior:
- [ ] Rachel references 2026, never 2024 or 2025
- [ ] Any time references are in Las Vegas time, not UTC

---

## Feature 5 — Client Dashboard

### Test K: Login
- Open: `https://YOUR_VERCEL_DOMAIN.vercel.app`
- [ ] Login page loads with dark theme
- [ ] Wrong password → shows error, doesn't log in
- [ ] Correct password (`DASHBOARD_PASSWORD`) → enters dashboard

### Test L: Data display
After running Tests A and C (which created entries):
- [ ] Waitlist table shows all entries
- [ ] Urgent entries show red badge
- [ ] Routine entries show green badge
- [ ] Stats bar shows correct "This Month" and "Urgent Pending" counts

### Test M: Filters
- [ ] "🚨 Urgent" filter → shows only urgent entries
- [ ] "Routine" filter → shows only routine entries
- [ ] "Not Contacted" filter → shows only uncontacted entries
- [ ] "Contacted" filter → shows only contacted entries
- [ ] "All" → shows everything

### Test N: Mark as contacted
- [ ] Click "✓ Contacted" on an entry → row dims, button changes to "Undo"
- [ ] Supabase → `contacted = true` for that row
- [ ] Click "Undo" → row un-dims, `contacted = false` in Supabase
- [ ] "Urgent Pending" stat updates correctly

### Test O: CSV export
- [ ] Click "↓ Export CSV"
- [ ] File downloads: `hammond-dental-waitlist-YYYY-MM-DD.csv`
- [ ] Open in Excel/Sheets — all columns present, data readable

### Test P: Sign out
- [ ] Click "Sign out" → returns to login page
- [ ] Refreshing the page also returns to login (session cleared)

---

## End-to-End Test — Full Call Simulation

Run this as a final smoke test before client demo:

1. Call the Vapi number during business hours
2. Say: "Hi, I have a broken tooth and it's really painful"
3. Give name: "Test Patient", phone: your real number
4. Verify:
   - [ ] Rachel responds with urgency/empathy
   - [ ] Supabase has new row: `priority = urgent`
   - [ ] Doctor emergency SMS received within 10 seconds
   - [ ] Dashboard shows the entry with red URGENT badge
5. Manually trigger morning summary cron
   - [ ] Front desk SMS received, includes the urgent entry
   - [ ] Dashboard entry now shows `contacted = true`
6. Call again, ask for a cleaning
7. Give name, number, preference
   - [ ] Supabase has new routine row
   - [ ] Dashboard shows it with green ROUTINE badge
   - [ ] Export CSV includes both entries

---

## Troubleshooting Quick Reference

| Symptom | Check |
|---------|-------|
| Vapi tool not calling webhook | Verify URL in tool JSON, check Vercel function logs |
| 401 on webhook | `x-vapi-secret` header doesn't match `VAPI_WEBHOOK_SECRET` |
| No doctor SMS on emergency | Check `DOCTOR_EMERGENCY_PHONE`, Twilio credentials, Vercel logs |
| Morning cron not firing | Check `CRON_SECRET`, Vercel Cron Jobs dashboard, UTC offset |
| Dashboard login fails | Check `DASHBOARD_PASSWORD` in Vercel env vars |
| Year shows wrong value | Verify system prompt is v3 (contains "current year is 2026") |
| Times show UTC | Verify `TIMEZONE=America/Los_Angeles` in Vercel env, `lib/timezone.js` is imported |
| Supabase insert fails | Check service role key, RLS policy, table exists |
