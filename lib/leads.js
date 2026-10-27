/**
 * The lead inbox. Every lead — calls, website forms, lead emails, manual
 * adds — becomes one client_leads row, and new non-call leads get an instant
 * response (speed-to-lead): a text from the business's AI line, an alert to
 * the owner, and optionally an AI call back.
 *
 *   createLead(client, fields)        → { lead, duplicate }
 *   speedToLead(client, lead)         → { texted, called, ownerAlerted }
 *   setLeadStatus(client, lead, next) → runs that status's automations
 */

import { supabase } from './supabase.js';
import { toE164, prettyPhone } from './phone.js';
import { sendSMS } from './sms.js';
import { isOpenAt } from './businessHours.js';
import { automationFor, templateVars, render } from './automation.js';

export const SOURCES = ['call', 'form', 'email', 'angi', 'thumbtack', 'meta', 'reactivation', 'manual', 'jobber', 'hcp'];
export const STATUSES = ['new', 'contacted', 'replied', 'estimate_sent', 'booked', 'job_done', 'won', 'lost'];
export const SOURCE_LABEL = {
  call: 'Phone call', form: 'Website form', email: 'Email', angi: 'Angi', thumbtack: 'Thumbtack', meta: 'Facebook',
  reactivation: 'Reactivation', manual: 'Added by hand', jobber: 'Jobber', hcp: 'Housecall Pro',
};

const DEDUPE_MS = 24 * 60 * 60 * 1000;
const clean = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);

/**
 * Insert a lead, or — if the same phone came in within 24h — fill in what the
 * earlier one was missing and return it as a duplicate (no second text).
 */
export async function createLead(client, fields, { now = new Date() } = {}) {
  const phone = toE164(fields.phone);
  const email = clean(fields.email, 200)?.toLowerCase() ?? null;
  if (!phone && !email) throw Object.assign(new Error('A lead needs a phone number or an email'), { status: 400 });

  const row = {
    client_id: client.id,
    source: SOURCES.includes(fields.source) ? fields.source : 'form',
    name: clean(fields.name, 120),
    phone,
    email,
    message: clean(fields.message, 2000),
    raw: fields.raw ?? null,
    status: fields.status ?? 'new',
    external_id: clean(fields.external_id, 120),
    vapi_call_id: fields.vapi_call_id ?? null,
    first_response_at: fields.first_response_at ?? null,
    received_at: now.toISOString(),
  };

  if (phone || email) {
    const since = new Date(now.getTime() - DEDUPE_MS).toISOString();
    let q = supabase.from('client_leads').select('*').eq('client_id', client.id).gte('received_at', since);
    q = phone ? q.eq('phone', phone) : q.eq('email', email);
    const { data: recent } = await q.order('received_at', { ascending: false }).limit(1);
    const prev = recent?.[0];
    if (prev) {
      const patch = {};
      for (const k of ['name', 'email', 'phone', 'message', 'external_id']) if (!prev[k] && row[k]) patch[k] = row[k];
      if (Object.keys(patch).length) {
        patch.updated_at = now.toISOString();
        await supabase.from('client_leads').update(patch).eq('id', prev.id);
      }
      return { lead: { ...prev, ...patch }, duplicate: true };
    }
  }

  const { data: lead, error } = await supabase.from('client_leads').insert([row]).select().single();
  if (error) throw new Error(`Couldn't save the lead: ${error.message}`);
  return { lead, duplicate: false };
}

/** The instant response to a new lead. Never throws — each step is independent. */
export async function speedToLead(client, lead, { now = new Date(), callLead = null } = {}) {
  const auto = automationFor(client);
  const out = { texted: false, called: false, ownerAlerted: false, errors: [] };
  const step = async (label, fn) => {
    try { return await fn(); } catch (err) { out.errors.push(`${label}: ${err.message}`); return null; }
  };

  if (lead.phone && auto.speed_text) {
    const body = render(auto.speed_template, templateVars(client, lead));
    out.texted = Boolean(await step('text', () => sendSMS(lead.phone, body, { client, kind: 'speed' })));
  }

  // AI calls the lead back: opt-in per client, business hours only.
  if (lead.phone && auto.speed_call && client.vapi_phone_number_id && client.agent_id
      && isOpenAt(now, client.timezone, client.business_hours)) {
    const place = callLead ?? (await import('./vapi.js')).createCall;
    out.called = Boolean(await step('call', () => place({
      assistantId: client.agent_id,
      phoneNumberId: client.vapi_phone_number_id,
      customer: { number: lead.phone, name: lead.name ?? undefined },
      assistantOverrides: {
        firstMessage: render(
          'Hi {first_name}, this is {agent}, an AI assistant with {business}, calling about the request you just sent us — this call may be recorded. Is now a good time?',
          templateVars(client, lead),
        ),
      },
    })));
  }

  const ownerPhone = client.owner_phone ?? client.doctor_phone;
  if (ownerPhone && auto.owner_alert) {
    const who = [lead.name, lead.phone && prettyPhone(lead.phone), lead.email].filter(Boolean).join(' · ');
    const did = out.called ? 'We texted and called them.' : out.texted ? 'We texted them back already.' : 'Reach out ASAP.';
    const body = `⚡ New ${SOURCE_LABEL[lead.source] ?? 'lead'} lead for ${client.business_name}\n${who}${lead.message ? `\n"${lead.message.slice(0, 300)}"` : ''}\n${did}`;
    out.ownerAlerted = Boolean(await step('owner alert', () => sendSMS(ownerPhone, body, { client, kind: 'owner_alert', skipOptOutCheck: true })));
  }

  if (out.texted || out.called) {
    await step('mark responded', () => supabase.from('client_leads')
      .update({ first_response_at: now.toISOString(), status: lead.status === 'new' ? 'contacted' : lead.status, updated_at: now.toISOString() })
      .eq('id', lead.id));
  }
  if (out.errors.length) console.error('[leads] speed-to-lead', client.slug, out.errors.join('; '));
  return out;
}

/** createLead + speedToLead for fresh leads — what every webhook calls. */
export async function receiveLead(client, fields, opts = {}) {
  const { lead, duplicate } = await createLead(client, fields, opts);
  const response = duplicate ? null : await speedToLead(client, lead, opts);
  return { lead, duplicate, response };
}

/** Change a lead's status and run whatever that status kicks off. */
export async function setLeadStatus(client, lead, status, extra = {}, { now = new Date() } = {}) {
  if (!STATUSES.includes(status)) throw Object.assign(new Error(`status must be one of ${STATUSES.join(', ')}`), { status: 400 });
  const patch = { status, updated_at: now.toISOString(), ...extra };
  const { data, error } = await supabase.from('client_leads').update(patch).eq('id', lead.id).select().single();
  if (error) throw new Error(error.message);
  // What each status kicks off (follow-ups, reminders, review requests) lives in
  // lib/statusAutomations.js — loaded here so this module stays dependency-free.
  const { runStatusAutomations } = await import('./statusAutomations.js');
  const automations = await runStatusAutomations(client, data, { prev: lead.status, now });
  return { lead: data, automations };
}

/** Business by its lead key (webhook URLs). */
export async function clientByLeadKey(key) {
  if (!key || String(key).length < 10) return null;
  const { data } = await supabase.from('clients').select('*').eq('lead_key', String(key)).eq('active', true).maybeSingle();
  return data ?? null;
}
