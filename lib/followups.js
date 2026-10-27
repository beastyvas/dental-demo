/**
 * Scheduled texts. Estimate follow-ups, appointment reminders, review
 * requests and reactivation messages are all followups rows; the cron
 * (/api/cron/followups, every 5 minutes) sends whatever is due.
 *
 *   schedule(client, lead, kind, items)   items: [{ sendAt, body?, step? }]
 *   cancelPending({ clientId, leadId?, phone?, kinds? })
 *   processDue({ now })
 *
 * Rules at send time: the business must be active (not paused/cancelled);
 * estimate follow-ups only go while the lead is still "estimate sent";
 * nothing but reminders goes out in quiet hours (deferred to the morning);
 * opt-outs are honored by sendSMS.
 */

import { supabase } from './supabase.js';
import { toE164 } from './phone.js';
import { sendSMS } from './sms.js';
import { zonedToUtcMs } from './slots.js';
import { automationFor } from './automation.js';

export const KINDS = ['estimate', 'reminder', 'review', 'reactivation'];
const QUIET_EXEMPT = new Set(['reminder']); // tied to an appointment time
// Review requests keep the 2-hour promise into the evening: they may go until
// 9pm (the federal limit) instead of the default 8pm.
const QUIET_OVERRIDES = { review: { quiet_start: 21 } };

export async function schedule(client, lead, kind, items) {
  const to = toE164(lead.phone);
  if (!to || !items.length) return [];
  const rows = items.map((it, i) => ({
    client_id: client.id,
    lead_id: lead.id ?? null,
    kind,
    step: it.step ?? i + 1,
    to_phone: to,
    body: it.body ?? null,
    send_at: new Date(it.sendAt).toISOString(),
    status: 'pending',
  }));
  const { data, error } = await supabase.from('followups').insert(rows).select();
  if (error) throw new Error(`Couldn't schedule ${kind} texts: ${error.message}`);
  return data ?? rows;
}

export async function cancelPending({ clientId, leadId = null, phone = null, kinds = KINDS }) {
  let q = supabase.from('followups').update({ status: 'cancelled' })
    .eq('client_id', clientId).eq('status', 'pending').in('kind', kinds);
  if (leadId) q = q.eq('lead_id', leadId);
  if (phone) q = q.eq('to_phone', toE164(phone));
  const { data } = await q.select('id');
  return data?.length ?? 0;
}

// ── Quiet hours ───────────────────────────────────────────────────────────

const localParts = (date, tz) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return { dateStr: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};
const nextDay = (dateStr) => new Date(Date.parse(`${dateStr}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** null if `date` is fine to text; otherwise the next allowed time (quiet_end that morning). */
export function quietUntil(date, tz, { quiet_start: start = 20, quiet_end: end = 8 } = {}) {
  const { dateStr, hour } = localParts(date, tz);
  if (hour >= end && hour < start) return null;
  const day = hour >= start ? nextDay(dateStr) : dateStr;
  return new Date(zonedToUtcMs(day, end, 0, tz));
}

// ── Sending ───────────────────────────────────────────────────────────────

const LIVE = new Set(['live', 'onboarding']);

const DEFAULT_SENDERS = {
  // Built at send time: a review_requests row + its rating-page link.
  review: async (client, row, lead) => {
    const { sendReviewRequest } = await import('./reviews.js');
    const out = await sendReviewRequest(client, { name: lead?.name ?? null, phone: row.to_phone });
    if (!out.smsSent) throw Object.assign(new Error(out.smsError ?? 'review text failed'), { optedOut: out.optedOut });
  },
};

export async function processDue({ now = new Date(), limit = 50, senders = {} } = {}) {
  const { data: due, error } = await supabase.from('followups').select('*')
    .eq('status', 'pending').lte('send_at', now.toISOString()).order('send_at', { ascending: true }).limit(limit);
  if (error) throw new Error(error.message);

  const clients = new Map();
  const leads = new Map();
  const getClient = async (id) => {
    if (!clients.has(id)) clients.set(id, (await supabase.from('clients').select('*').eq('id', id).maybeSingle()).data);
    return clients.get(id);
  };
  const getLead = async (id) => {
    if (!id) return null;
    if (!leads.has(id)) leads.set(id, (await supabase.from('client_leads').select('*').eq('id', id).maybeSingle()).data);
    return leads.get(id);
  };
  const mark = (row, patch) => supabase.from('followups').update(patch).eq('id', row.id);

  const summary = { sent: 0, deferred: 0, skipped: 0, cancelled: 0, failed: 0 };
  for (const row of due ?? []) {
    const client = await getClient(row.client_id);
    if (!client || !client.active || !LIVE.has(client.status ?? 'live')) {
      await mark(row, { status: 'skipped', error: 'business not active' }); summary.skipped++; continue;
    }
    const lead = await getLead(row.lead_id);
    if (row.kind === 'estimate' && lead && lead.status !== 'estimate_sent') {
      await mark(row, { status: 'cancelled', error: `lead is ${lead.status}` }); summary.cancelled++; continue;
    }
    if (!QUIET_EXEMPT.has(row.kind)) {
      const until = quietUntil(now, client.timezone || 'America/Los_Angeles', { ...automationFor(client), ...QUIET_OVERRIDES[row.kind] });
      if (until) { await mark(row, { send_at: until.toISOString() }); summary.deferred++; continue; }
    }
    try {
      const send = senders[row.kind] ?? DEFAULT_SENDERS[row.kind] ?? ((c, r) => sendSMS(r.to_phone, r.body, { client: c, kind: r.kind }));
      await send(client, row, lead);
      await mark(row, { status: 'sent', sent_at: now.toISOString(), error: null });
      summary.sent++;
    } catch (err) {
      await mark(row, { status: err.optedOut ? 'skipped' : 'failed', error: String(err.message).slice(0, 500) });
      summary[err.optedOut ? 'skipped' : 'failed']++;
    }
  }
  return summary;
}
