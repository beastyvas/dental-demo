/**
 * /api/leads/:source — where leads come in from outside the phone line.
 *
 *   POST /api/leads/form?key=<lead_key>   website quote forms (JSON or a plain
 *        HTML form post; `_redirect` sends the browser on afterwards,
 *        `company_website` is a honeypot)
 *   POST /api/leads/email                 lead emails, posted by the Cloudflare
 *        Email Worker (cloudflare/lead-email-worker) with the x-lead-secret header
 *
 * Every lead gets speed-to-lead (lib/leads.js) before this responds, so the
 * text goes out within seconds.
 */

import crypto from 'node:crypto';
import { supabase } from '../supabase.js';
import { receiveLead, clientByLeadKey } from '../leads.js';
import { parseLeadEmail, parseLeadAddress } from '../leadParse.js';
import { sendSMS } from '../sms.js';

const str = (v) => (Array.isArray(v) ? v[0] : v);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const raw = String(req.body ?? '');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return Object.fromEntries(new URLSearchParams(raw)); }
}

// Only send browsers back to a plain http(s) URL.
const safeRedirect = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.toString() : null; } catch { return null; } };

const THANKS = (name) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thanks!</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;text-align:center;color:#111}</style></head>
<body><h1>Thanks — we got it.</h1><p>${name ? `${name} will` : "We'll"} be in touch shortly. Check your phone for a text from us.</p></body></html>`;

export async function formLead(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = parseBody(req);
  const client = await clientByLeadKey(str(req.query.key) ?? body.key);
  if (!client) return res.status(404).json({ error: 'Unknown form' });

  const isJson = String(req.headers['content-type'] ?? '').includes('application/json');
  const redirect = safeRedirect(body._redirect);
  const done = () => {
    if (redirect) { res.setHeader('Location', redirect); return res.status(303).end(); }
    if (isJson) return res.status(200).json({ ok: true });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(THANKS(client.business_name));
  };

  // Honeypot: bots fill every field; people never see this one.
  if (body.company_website) return done();

  const name = body.name ?? [body.first_name, body.last_name].filter(Boolean).join(' ');
  const message = [body.service, body.message ?? body.details ?? body.comments].filter(Boolean).join(' — ');
  try {
    await receiveLead(client, {
      source: 'form', name, phone: body.phone, email: body.email, message,
      raw: { ...body, page: req.headers.referer ?? null },
    });
  } catch (err) {
    if (err.status === 400) return isJson ? res.status(400).json({ error: err.message }) : res.status(400).send(err.message);
    console.error('[leads/form]', client.slug, err.message);
    return res.status(500).json({ error: 'Could not save — please call us instead.' });
  }
  return done();
}

export async function emailLead(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const secret = process.env.LEAD_EMAIL_SECRET;
  const got = String(req.headers['x-lead-secret'] ?? '');
  if (!secret || got.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const mail = parseBody(req);
  const addr = parseLeadAddress(mail.to);
  if (!addr) return res.status(404).json({ error: `Not a lead address: ${mail.to}` });

  const { data: client } = await supabase.from('clients').select('*').eq('slug', addr.slug).eq('active', true).maybeSingle();
  if (!client?.lead_key || !client.lead_key.toLowerCase().startsWith(addr.key)) {
    return res.status(404).json({ error: 'Unknown lead address' });
  }

  // The business's own numbers show up in these emails too — never text them.
  const parsed = parseLeadEmail(mail, {
    ignorePhones: [client.twilio_number, client.owner_phone, client.transfer_phone, client.config?.owner_phone].filter(Boolean),
  });
  try {
    const { lead, duplicate, response } = await receiveLead(client, {
      ...parsed,
      raw: { from: mail.from, to: mail.to, subject: mail.subject, text: String(mail.text ?? '').slice(0, 20000) },
    });
    return res.status(200).json({ lead_id: lead.id, duplicate, parsed, texted: response?.texted ?? false });
  } catch (err) {
    if (err.status === 400) {
      // Nothing to reach them on — still tell the owner a lead email arrived.
      const owner = client.owner_phone ?? client.doctor_phone;
      if (owner) {
        await sendSMS(owner, `📧 A lead email for ${client.business_name} came in but had no phone or email we could read: "${String(mail.subject ?? '').slice(0, 120)}". Check your inbox.`,
          { client, kind: 'owner_alert', skipOptOutCheck: true }).catch((e) => console.error('[leads/email] owner alert', e.message));
      }
      return res.status(200).json({ skipped: 'no phone or email found', parsed });
    }
    console.error('[leads/email]', client.slug, err.message);
    return res.status(500).json({ error: err.message });
  }
}
