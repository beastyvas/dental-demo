/**
 * Job software → lead status. A finished job starts the review request; a
 * sent quote starts the estimate follow-up.
 *
 *   POST /api/leads/jobber                 Jobber webhook (HMAC-signed)
 *   GET  /api/leads/jobber-callback        Jobber OAuth redirect
 *   POST /api/leads/hcp?key=<lead_key>     Housecall Pro webhook
 *   POST /api/leads/job-complete?key=…     generic: { name, phone, email?, event?: job_done|estimate_sent, id? }
 */

import { supabase } from '../supabase.js';
import { toE164 } from '../phone.js';
import { createLead, setLeadStatus, clientByLeadKey } from '../leads.js';
import * as jobber from '../jobber.js';

const baseUrl = () =>
  (process.env.DEPLOYMENT_URL || process.env.DASHBOARD_URL || `https://${process.env.VERCEL_DOMAIN}`).replace(/\/$/, '');

/** Find (or create) the customer's lead and move it to `status`. */
export async function applyJobEvent(client, source, customer, status) {
  const phone = toE164(customer.phone);
  if (!phone && !customer.email) return { skipped: 'no phone or email on the customer' };
  let lead = null;
  if (phone) {
    const { data } = await supabase.from('client_leads').select('*').eq('client_id', client.id).eq('phone', phone)
      .order('received_at', { ascending: false }).limit(1);
    lead = data?.[0] ?? null;
  }
  if (!lead) {
    ({ lead } = await createLead(client, {
      source, name: customer.name, phone, email: customer.email, message: customer.title,
      external_id: customer.external_id, status: 'contacted',
    }));
  }
  if (lead.status === status) return { lead_id: lead.id, unchanged: true };
  const { automations } = await setLeadStatus(client, lead, status);
  return { lead_id: lead.id, status, automations };
}

async function readRaw(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = [];
  try { for await (const c of req) chunks.push(Buffer.from(c)); } catch { /* already consumed */ }
  if (chunks.length) return Buffer.concat(chunks).toString('utf8');
  return req.body ? JSON.stringify(req.body) : '';
}

export async function jobberWebhook(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const raw = await readRaw(req);
  if (!jobber.validWebhook(raw, req.headers['x-jobber-hmac-sha256'])) return res.status(401).json({ error: 'Bad signature' });
  let event;
  try { event = JSON.parse(raw)?.data?.webHookEvent; } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  if (!event?.topic || !event.itemId) return res.status(400).json({ error: 'No webHookEvent' });

  const action = jobber.TOPIC_ACTIONS.find((a) => a.match.test(event.topic));
  if (!action) return res.status(200).json({ ignored: event.topic });

  const { data: client } = await supabase.from('clients').select('*')
    .eq('integrations->jobber->>account_id', event.accountId).eq('active', true).maybeSingle();
  if (!client) return res.status(200).json({ ignored: 'no business connected to this Jobber account' });

  try {
    const customer = await jobber.fetchCustomer(client, action.object, event.itemId);
    if (!customer) return res.status(200).json({ ignored: 'no customer on the item' });
    return res.status(200).json(await applyJobEvent(client, 'jobber', customer, action.status));
  } catch (err) {
    console.error('[jobber]', client.slug, event.topic, err.message);
    // 5xx makes Jobber retry (at-least-once delivery); our handling is idempotent.
    return res.status(502).json({ error: err.message });
  }
}

const page = (title, msg) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;text-align:center;color:#111}</style></head>
<body><h1>${title}</h1><p>${msg}</p></body></html>`;

export async function jobberCallback(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const clientId = jobber.readState(req.query.state);
  if (!clientId || !req.query.code) return res.status(400).send(page('Link expired', 'Ask us for a new Jobber connect link.'));
  try {
    const account = await jobber.connect(clientId, String(req.query.code), baseUrl());
    return res.status(200).send(page('Jobber connected ✓', `${account.name ?? 'Your Jobber account'} is connected. Finished jobs will now get a review request automatically. You can close this page.`));
  } catch (err) {
    console.error('[jobber-callback]', err.message);
    return res.status(502).send(page('Something went wrong', 'We couldn\'t finish connecting Jobber. Please try the link again.'));
  }
}

// Housecall Pro's webhook payload isn't publicly documented in detail; read
// the customer from wherever it sits and log what we couldn't use.
export function hcpCustomer(body) {
  const job = body.job ?? body.estimate ?? body.data ?? body;
  const c = job.customer ?? body.customer ?? {};
  const name = c.name ?? [c.first_name, c.last_name].filter(Boolean).join(' ');
  return {
    name: name || null,
    phone: c.mobile_number ?? c.cell_phone ?? c.phone_number ?? c.home_number ?? c.work_number ?? null,
    email: c.email ?? null,
    title: job.description ?? job.name ?? null,
    external_id: c.id ?? null,
  };
}

const HCP_EVENTS = [
  { match: /job\.(completed|finished)/i, status: 'job_done' },
  { match: /estimate\.(sent|created)/i, status: 'estimate_sent' },
];

export async function hcpWebhook(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const client = await clientByLeadKey(req.query.key);
  if (!client) return res.status(404).json({ error: 'Unknown webhook' });
  const body = req.body ?? {};
  const event = String(body.event ?? body.event_type ?? body.type ?? '');
  const action = HCP_EVENTS.find((e) => e.match.test(event));
  if (!action) return res.status(200).json({ ignored: event || 'no event name' });
  return res.status(200).json(await applyJobEvent(client, 'hcp', hcpCustomer(body), action.status));
}

export async function genericJobEvent(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const client = await clientByLeadKey(req.query.key);
  if (!client) return res.status(404).json({ error: 'Unknown webhook' });
  const b = req.body ?? {};
  const status = b.event === 'estimate_sent' ? 'estimate_sent' : 'job_done';
  return res.status(200).json(await applyJobEvent(client, 'manual', {
    name: b.name, phone: b.phone, email: b.email, title: b.title, external_id: b.id,
  }, status));
}
