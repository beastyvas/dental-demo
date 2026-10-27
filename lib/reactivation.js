/**
 * Reactivation campaigns: text a business's past customers ("it's been a
 * while — want us to take a look?"), paced and inside allowed hours.
 *
 * Texts are spaced at automation.reactivation_per_hour across allowed hours
 * (never a 8am burst). Replies forward to the owner and become leads
 * (api/twilio); STOP opts them out. Past customers must have given the
 * business their number for texts — the CRM makes us attest to that.
 */

import { supabase } from './supabase.js';
import { toE164 } from './phone.js';
import { quietUntil } from './followups.js';
import { automationFor, templateVars, render } from './automation.js';

export const MAX_ROWS = 2000;
const ACTIVE = ['new', 'contacted', 'replied', 'estimate_sent', 'booked'];

/** Send times: start now (or this morning), spaced, skipping quiet hours. */
export function sendTimes(count, { now, perHour, tz, auto }) {
  const gap = Math.ceil(3_600_000 / Math.max(1, perHour));
  const out = [];
  let t = new Date(now);
  for (let i = 0; i < count; i++) {
    const until = quietUntil(t, tz, auto);
    if (until) t = until;
    out.push(new Date(t));
    t = new Date(t.getTime() + gap);
  }
  return out;
}

/**
 * rows: [{ name, phone, last_service }]. dryRun → counts + previews only.
 * Returns { scheduled, skipped: { invalid, duplicate, optedOut, active }, first_send_at, last_send_at, preview }.
 */
export async function planCampaign(client, rows, { template, dryRun = false, now = new Date() } = {}) {
  const auto = automationFor(client);
  const tpl = template?.trim() || auto.reactivation_template;
  const skipped = { invalid: 0, duplicate: 0, optedOut: 0, active: 0 };
  const seen = new Set();
  const keep = [];

  // People already in the pipeline aren't "past customers" right now.
  const [{ data: open }, { data: outs }] = await Promise.all([
    supabase.from('client_leads').select('phone').eq('client_id', client.id).in('status', ACTIVE),
    supabase.from('opt_outs').select('phone').eq('client_id', client.id),
  ]);
  const busy = new Set((open ?? []).map((l) => l.phone));
  const optedOut = new Set((outs ?? []).map((o) => o.phone));

  for (const row of rows.slice(0, MAX_ROWS)) {
    const phone = toE164(row.phone);
    if (!phone) { skipped.invalid++; continue; }
    if (seen.has(phone)) { skipped.duplicate++; continue; }
    seen.add(phone);
    if (busy.has(phone)) { skipped.active++; continue; }
    if (optedOut.has(phone)) { skipped.optedOut++; continue; }
    keep.push({ name: row.name?.trim() || null, phone, service: row.last_service?.trim() || '' });
  }

  const times = sendTimes(keep.length, { now, perHour: auto.reactivation_per_hour, tz: client.timezone || 'America/Los_Angeles', auto });
  const items = keep.map((p, i) => ({
    phone: p.phone,
    sendAt: times[i],
    body: render(tpl, templateVars(client, { name: p.name, service: p.service || 'last service' })),
  }));

  if (!dryRun) {
    // One followups row per person (lead_id null — a lead is made if they reply).
    const rowsOut = items.map((it) => ({
      client_id: client.id, lead_id: null, kind: 'reactivation', step: 1,
      to_phone: it.phone, body: it.body, send_at: it.sendAt.toISOString(), status: 'pending',
    }));
    for (let i = 0; i < rowsOut.length; i += 500) {
      const { error } = await supabase.from('followups').insert(rowsOut.slice(i, i + 500));
      if (error) throw new Error(`Scheduled ${i} of ${rowsOut.length} before an error: ${error.message}`);
    }
  }
  return {
    scheduled: items.length,
    skipped,
    truncated: Math.max(0, rows.length - MAX_ROWS),
    first_send_at: times[0]?.toISOString() ?? null,
    last_send_at: times.at(-1)?.toISOString() ?? null,
    preview: items.slice(0, 3).map((it) => ({ to: it.phone, body: it.body, at: it.sendAt.toISOString() })),
  };
}
