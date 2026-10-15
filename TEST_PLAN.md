# Test Plan: Tiered Offer (CRM) + Answer Desk (dental-demo)

Work top to bottom. Check each box when it passes. When something fails, send the report from **When something breaks** at the bottom.

Use a second phone (not the owner's cell) for every test call.

---

## 0. Setup (do once, in this order)

**Database (Supabase SQL editor)**
- [ ] dental-demo project: run `sql/017_answer_desk.sql`. It should finish with no errors.
- [ ] Check that the tables `calls`, `messages` and `opt_outs` now exist.
- [ ] CRM project: run `supabase/migrations/2026-10-14_tiered_offer.sql`. This re-prices open leads.

**Vercel: dental-demo project, Settings → Environment Variables**
- [ ] `TWILIO_ACCOUNT_SID`
- [ ] `TWILIO_AUTH_TOKEN`
- [ ] `ADMIN_ALERT_PHONE`: your cell, `+1702…`
- [ ] `DASHBOARD_URL`: the dashboard's https URL
- [ ] Redeploy, then confirm the latest deployment is "Ready".

**Your laptop**
- [ ] `git pull` dental-demo. Create `.env.local` with:
  - `VAPI_API_KEY`
  - `VAPI_WEBHOOK_SECRET`
  - `DEPLOYMENT_URL`
  - `TEMPLATE_ASSISTANT_ID`: use the demo assistant's id
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Run `npm install`, then `npm test`. Expect 35 passing.

**Twilio**
- [ ] Start A2P 10DLC brand + campaign registration (Messaging → Regulatory compliance).
  - Approval takes 1+ weeks.
  - Calls work right away; texts to customers may be filtered until approval.
  - Texts to your own phones usually still arrive.

---

## 1. CRM public site (nickbuilds.com)

**Homepage `/`**
- [ ] The Packages section shows 3 cards:
  - Answer Desk: **$497/mo + $1,500 setup**
  - Booked Jobs System: **$797/mo + $3,000**, marked "Most popular"
  - Full Office: **$1,197/mo + $5,000**, marked "Limited to 3 clients"
- [ ] Each card has a Guarantee block.
- [ ] The Founding Crew banner shows under the cards. Its button jumps to the callback form.
- [ ] The Services tabs say "Included in …". No old prices ($99, $500, $100/mo) anywhere.
- [ ] FAQ: pricing, guarantee, Founding Crew, Jobber question, AI disclosure. Nothing about "win-back".
- [ ] The calculator uses $797.

**Callback form**
- [ ] The dropdown starts with "Free missed-lead audit". The consent checkbox is **unchecked** by default.
- [ ] Submit **with** the box checked. The lead appears in the CRM with notes containing `[SMS/AI-CALL CONSENT <time> ip=… page=2026-10-14 …]`.
- [ ] Submit **without** the box checked (use a different phone number). Notes say `[NO SMS CONSENT — call or email only]`.
- [ ] The notification email shows a "SMS consent" row.

**Demo page `/demo` (check on your phone)**
- [ ] The hero box reads "$0 · until it delivers". There's no $99.
- [ ] The Terms block shows Founding Crew, $0 up front and the 3 tier prices.
- [ ] The FAQ has 6 questions with the new pricing.
- [ ] The "Leave your number" form submits and lands in the CRM as "Free missed-lead audit".

**Other places**
- [ ] View page source, or share the link in iMessage. Title and description mention "Booked Jobs System". No "$99".

---

## 2. CRM dashboard (`/dashboard`)

**Dialer**
- [ ] A lead shows the green "Pitch the … — $3k + $797/mo" box with the guarantee line. "Upsell to Full Office" works.
- [ ] Call Script → **Opener** tab ends with the 🔎 missed-lead audit tip.
- [ ] **Close** tab: the close quotes the tier price plus guarantee. Below it is the Founding Crew close.
- [ ] **Objections** tab includes:
  - "That's too expensive"
  - "Jobber… $29"
  - "What if it doesn't work?"
  - "Can you do it cheaper?"
- [ ] Log tab → text templates include "🔎 Audit result" and "🤝 Founding spot".

**Close deal, on a test lead**
- [ ] Click "Closed the Deal". Three tier buttons appear, the recommended one is preselected, and the monthly field is filled in.
- [ ] Pick Booked Jobs, tick Founding Crew, then ✓. In Pipeline/Edit the lead shows:
  - deal value **3000**
  - recommended offer "Booked Jobs System (Founding Crew)"
  - setup "$3,000 deferred — Founding Crew"
- [ ] Analytics: "New MRR This Month" rises by 797. "Setup signed" shows $3k. The target matches your MRR goal (not $10k).
- [ ] Undo the test lead afterwards so it doesn't count toward your MRR.

**Elsewhere**
- [ ] The Offers Playbook shows 3 tiers with setup, guarantee and "Say it like this", plus the Founding Crew card.
- [ ] The "By Pain Point" tab shows each pain as "Booked Jobs System · $3k + $797/mo" (or its tier).
- [ ] Pipeline: an expanded lead shows "Recommend: … — $3k + $797/mo" plus the guarantee.
- [ ] Find tab: a new scrape saves leads with the tier pitch, not "$500/mo".
- [ ] Demo recap AI: schedule a demo, generate a recap. It names a tier, price and guarantee.

---

## 3. dental-demo: existing setup still works (regression)

- [ ] Log in to the dashboard as admin. All clients load.
- [ ] Open a client. Leads, filters, "Scheduled" and Delete still work.
- [ ] **Call the demo agent.** You hear "I'm an AI assistant, and this call may be recorded".
  - The agent works as before. Old tool URLs are rewritten.
  - Note: existing agents only get the new greeting after `npm run vapi:sync demo <url>`. Run it if you hear the old greeting.
- [ ] Book something on the demo agent. It shows in the dashboard.
- [ ] Maintenance America (if still connected): a booking reaches Google Calendar.
- [ ] Review funnel (Aveda or any review-enabled client): sending a request still delivers a text.

---

## 4. Onboard a test client

Set up a fake HVAC company where you are the owner.

- [ ] `cp clients/example.json clients/test-hvac.json`. Set:
  - `slug: "test-hvac"`
  - `owner_phone`: your cell
  - `transfer_phone`: your cell
  - a calendar id, if you have a test Google Calendar shared with the service account
- [ ] `npm run onboard -- test-hvac --dry-run`. Read the whole script. Does it sound right for an HVAC shop? Anything weird?
- [ ] `npm run onboard -- test-hvac --buy-number`. It prints:
  - the new number
  - the dashboard password
  - the forwarding codes
  - the test checklist
- [ ] Vapi dashboard:
  - the new assistant exists with 6 tools (5 plus transfer)
  - Server URL is `/api/vapi/events`
  - the phone number is attached
- [ ] Twilio console: the number's **Messaging** webhook is `…/api/twilio/sms`. If Vapi overwrote it, tell me.
- [ ] Supabase `clients` has a `test-hvac` row with `twilio_number` and `vapi_phone_number_id` filled in.
- [ ] Re-run without `--buy-number`. It says "updated" everywhere and does **not** buy a second number.
- [ ] Repeat the dry-run with `"trade": "roofing"`, then `remodel`, then `emergency-trade`. Read each one.

---

## 5. Call tests (call the new number from a second phone)

| # | Do this | Expect |
|---|---|---|
| 5.1 | Call. Listen to the first line. | "Thanks for calling …, this is Riley, an AI assistant — this call may be recorded." |
| 5.2 | Ask "Are you a real person?" | It says it's an AI assistant and keeps helping. It never claims to be human. |
| 5.3 | "My AC is blowing warm, can someone come Tuesday?" Give name, number, address, then pick a time it offers. | It asks the triage questions and offers only open times. It reads back the details and gives a confirmation number. A Calendar event appears (if connected). |
| 5.4 | Ask for a time you already blocked on that calendar. | "That time is taken" and it offers alternatives. |
| 5.5 | "AC's out, it's 112, my mom's 80 and she's here." | Urgent handling. **🚨 text to your cell within seconds.** It offers transfer or soonest booking. |
| 5.6 | "I smell gas." | It tells you to get out and call 911/gas company first, then sends the alert. |
| 5.7 | "Can I talk to Mike?" | Transfer message, then your cell rings. |
| 5.8 | Ask for a quote and refuse to book. | It saves you as a lead and gives the callback promise. |
| 5.9 | "How much is a service call?" | It quotes the `service_fee` from the config and nothing else. |
| 5.10 | Call and hang up right after the greeting. | Within ~1 min: a "sorry we didn't get to finish" text to the calling phone, and an owner text saying "MISSED — CALLER HUNG UP … We texted them back." |
| 5.11 | Hang up early again from the same phone. | **No** second text-back (24h limit). |
| 5.12 | Pretend to be a robocall or vendor pitch. | It takes a message and ends the call. Outcome is "spam" and no owner text. |
| 5.13 | Call outside the business hours in the config. | It says you're closed but still helps. The dashboard shows an "after hours" tag. |
| 5.14 | Call with caller ID blocked (`*67`). | The call still works and nothing crashes. No text-back is possible. |

**After every call:** your cell gets a summary text within ~1 minute. Check:
- [ ] The label is right (✅ JOB BOOKED / 🚨 URGENT / 📝 NEW LEAD / ☎️ MISSED…).
- [ ] Caller name and number are correct.
- [ ] The "Needs:" line makes sense.
- [ ] The summary is readable.
- [ ] The dashboard link opens.

---

## 6. Texting

- [ ] Reply to the text-back from 5.10 with "Can you come Thursday?". Your cell gets "💬 Text from (702)… : Can you come Thursday?"
- [ ] Reply **STOP**. Twilio sends its standard opt-out reply. Supabase `opt_outs` gets a row.
- [ ] After STOP, call from that phone and hang up early. **No** text-back.
- [ ] Reply **START**. The `opt_outs` row is gone.
- [ ] Supabase `messages` table: every text from the tests above is logged with the right `kind`.

---

## 7. Client dashboard

Log in with the password onboarding printed.

- [ ] A **Calls** section appears above the leads, with stats:
  - Calls Answered
  - After Hours
  - Leads Captured
  - Minutes Used / 500
- [ ] Every test call is listed with the right result badge. Click a row to see the summary, the recording (it plays) and the transcript.
- [ ] Leads Captured counts booked, urgent, lead and transferred calls only. Hang-ups, spam and questions don't count.
- [ ] **Switch OFF** the AI receptionist, then call the number. **Your cell rings directly**, with no AI.
- [ ] **Switch ON**, then call again. The AI answers.
  - If the switch shows an error ("Couldn't reach the phone system"), screenshot it and tell me. Vapi may need a different "detach" call.
- [ ] Review request from this client: the text contains a link to `/review/…`.
  - 5 stars goes to Google.
  - 1–3 stars goes to the private feedback form.

---

## 8. Forwarding (real-world setup)

- [ ] On a spare line, or with the owner, set forward-on-no-answer to the AI number using the printed carrier code.
- [ ] Call that business line and don't pick up. After ~4–5 rings the AI answers.
- [ ] Confirm the caller ID in the summary text is the **original caller**, not the business line.

---

## 9. Cleanup after testing
- [ ] Delete the test leads and test deal in the CRM.
- [ ] Keep `test-hvac` as your live demo line, or release the Twilio number and delete the Vapi assistant.

---

## When something breaks, send me this

```
Test #:
What I did:
What I expected:
What happened:
Time (approx) + phone number used:
Screenshot / text I got:
```

It also helps a lot to include:
- the Vercel logs for that minute (Project → Logs, filter `/api/vapi/events` or `/api/twilio/sms`)
- the Vapi call log entry (Vapi dashboard → Calls → that call → "Ended reason")
