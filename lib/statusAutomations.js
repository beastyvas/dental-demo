/**
 * What a lead status change kicks off. Called by setLeadStatus (lib/leads.js)
 * after the status is saved. Returns short notes ("5 follow-up texts
 * scheduled") for the dashboard to show.
 */

import { supabase } from './supabase.js';
import { schedule, cancelPending } from './followups.js';
import { automationFor, templateVars, render } from './automation.js';

/** "Wed, Oct 28 at 2:00 PM" in the business's timezone. */
export function appointmentLabel(iso, tz = 'America/Los_Angeles') {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}

const DAY_MS = 86_400_000;

async function startEstimateFollowup(client, lead, now) {
  if (!lead.phone) return 'No phone on this lead — no follow-up texts';
  const auto = automationFor(client);
  await cancelPending({ clientId: client.id, leadId: lead.id, kinds: ['estimate'] });
  const vars = templateVars(client, lead);
  const items = auto.estimate_days.map((days, i) => ({
    sendAt: new Date(now.getTime() + days * DAY_MS),
    body: render(auto.estimate_templates[i] ?? auto.estimate_templates.at(-1), vars),
    step: i + 1,
  }));
  await schedule(client, lead, 'estimate', items);
  return `${items.length} follow-up texts scheduled over ${auto.estimate_days.at(-1)} days — they stop when ${vars.first_name || 'the customer'} replies`;
}

async function scheduleReminders(client, lead, now) {
  await cancelPending({ clientId: client.id, leadId: lead.id, kinds: ['reminder'] });
  if (!lead.phone || !lead.appointment_at) return null;
  const auto = automationFor(client);
  const appt = new Date(lead.appointment_at).getTime();
  const when = appointmentLabel(lead.appointment_at, client.timezone || 'America/Los_Angeles');
  const body = render(auto.reminder_template, templateVars(client, { ...lead, service: lead.message }, { when }));
  const items = auto.reminder_offsets_min
    .map((min, i) => ({ sendAt: new Date(appt - min * 60_000), body, step: i + 1 }))
    .filter((it) => it.sendAt.getTime() > now.getTime());
  if (!items.length) return 'Appointment is too soon for reminder texts';
  await schedule(client, lead, 'reminder', items);
  return `${items.length} reminder text${items.length === 1 ? '' : 's'} scheduled before ${when}`;
}

const REVIEW_REPEAT_DAYS = 90;
const REVIEW_MAX_DELAY_MIN = 110; // the Full Office promise is "within 2 hours"

async function scheduleReviewRequest(client, lead, now) {
  if (!lead.phone) return 'No phone on this lead — no review request';
  const since = new Date(now.getTime() - REVIEW_REPEAT_DAYS * DAY_MS).toISOString();
  const [{ data: recent }, { data: queued }] = await Promise.all([
    supabase.from('review_requests').select('id').eq('client_id', client.id).eq('patient_phone', lead.phone).gte('sent_at', since).limit(1),
    supabase.from('followups').select('id').eq('client_id', client.id).eq('to_phone', lead.phone).eq('kind', 'review').eq('status', 'pending').limit(1),
  ]);
  if (recent?.length || queued?.length) return `Already asked for a review in the last ${REVIEW_REPEAT_DAYS} days`;
  const delay = Math.min(Math.max(Number(automationFor(client).review_delay_min) || 0, 0), REVIEW_MAX_DELAY_MIN);
  await schedule(client, lead, 'review', [{ sendAt: new Date(now.getTime() + delay * 60_000) }]);
  return `Review request goes out in about ${Math.max(delay, 5)} minutes`;
}

export async function runStatusAutomations(client, lead, { prev, now }) {
  const notes = [];
  if (lead.status === 'job_done') notes.push(await scheduleReviewRequest(client, lead, now));
  if (lead.status === 'booked') {
    const note = await scheduleReminders(client, lead, now);
    if (note) notes.push(note);
  } else if (lead.status === 'lost') {
    // Won or job done keep their reminders — the appointment still happens.
    await cancelPending({ clientId: client.id, leadId: lead.id, kinds: ['reminder'] });
  }
  if (lead.status === 'estimate_sent') {
    notes.push(await startEstimateFollowup(client, lead, now));
  } else if (prev === 'estimate_sent') {
    const n = await cancelPending({ clientId: client.id, leadId: lead.id, kinds: ['estimate'] });
    if (n) notes.push(`Stopped ${n} follow-up text${n === 1 ? '' : 's'}`);
  }
  if (lead.status === 'won' || lead.status === 'lost') {
    await cancelPending({ clientId: client.id, leadId: lead.id, kinds: ['estimate', 'reactivation'] });
  }
  return notes;
}
