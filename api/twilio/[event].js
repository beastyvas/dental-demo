/**
 * /api/twilio/:event — Twilio webhooks. Onboarding points each client
 * number's SMS URL at /api/twilio/sms.
 *
 *   sms   inbound text to a client's number:
 *         STOP-type keyword  → record opt-out (Twilio sends the carrier reply)
 *         START-type keyword → remove opt-out
 *         anything else      → forward to the owner, log it
 *
 * Requests must carry a valid X-Twilio-Signature.
 */

import { supabase }               from '../../lib/supabase.js';
import { sendSMS }                from '../../lib/sms.js';
import { toE164, prettyPhone }    from '../../lib/phone.js';
import { isValidTwilioSignature } from '../../lib/twilio.js';
import { optKeyword }             from '../../lib/optout.js';
import { cancelPending } from '../../lib/followups.js';

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// The URL Twilio signed. Vercel may append the dynamic route param
// (?event=sms) to req.url, so we also try it without that.
function candidateUrls(req) {
  const proto = req.headers['x-forwarded-proto'] ?? 'https';
  const host  = req.headers['x-forwarded-host'] ?? req.headers.host;
  const full  = `${proto}://${host}${req.url}`;
  const u = new URL(full);
  u.searchParams.delete('event');
  return [...new Set([full, u.toString().replace(/\?$/, '')])];
}

function twiml(res, status = 200) {
  res.setHeader('Content-Type', 'text/xml');
  return res.status(status).send(EMPTY_TWIML);
}

async function handleSms(params) {
  const from = toE164(params.From);
  const to   = toE164(params.To);
  const body = String(params.Body ?? '').trim();

  const { data: client } = await supabase.from('clients').select('*').eq('twilio_number', to).maybeSingle();
  const clientId = client?.id ?? null;

  await supabase.from('messages').insert([{
    client_id: clientId, direction: 'inbound', from_number: from, to_number: to,
    body, kind: 'reply', twilio_sid: params.MessageSid ?? null, status: 'received',
  }]);

  const kw = optKeyword(body);
  if (kw === 'stop') {
    await supabase.from('opt_outs').upsert([{ client_id: clientId, phone: from }], { onConflict: 'client_id,phone' });
    if (clientId) await cancelPending({ clientId, phone: from });
    return;
  }
  if (kw === 'start') {
    let q = supabase.from('opt_outs').delete().eq('phone', from);
    q = clientId ? q.eq('client_id', clientId) : q.is('client_id', null);
    await q;
    return;
  }

  const ownerPhone = client?.owner_phone ?? client?.doctor_phone;
  if (ownerPhone && from !== toE164(ownerPhone)) {
    // A reply means a person is talking now — stop the automated nudges.
    const stopped = await cancelPending({ clientId, phone: from, kinds: ['estimate', 'reactivation'] }).catch(() => 0);
    await supabase.from('client_leads').update({ status: 'replied', updated_at: new Date().toISOString() })
      .eq('client_id', clientId).eq('phone', from).in('status', ['new', 'contacted', 'estimate_sent']);
    await sendSMS(ownerPhone, `💬 Text from ${prettyPhone(from)} to ${client.business_name}:\n"${body.slice(0, 500)}"\nReply to them directly at ${prettyPhone(from)}.${stopped ? ' (Follow-up texts stopped.)' : ''}`,
      { client, kind: 'reply', skipOptOutCheck: true });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const params = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : (req.body ?? {});
  const valid = candidateUrls(req).some((url) => isValidTwilioSignature({
    authToken: process.env.TWILIO_AUTH_TOKEN,
    signature: req.headers['x-twilio-signature'],
    url,
    params,
  }));
  if (!valid) return res.status(403).json({ error: 'Invalid Twilio signature' });

  try {
    if (req.query.event === 'sms') await handleSms(params);
    else return res.status(404).json({ error: `Unknown event: ${req.query.event}` });
  } catch (err) {
    // Still 200 — a Twilio retry won't fix our bug, and the inbound text is logged above when possible.
    console.error('[twilio] error:', err);
  }
  return twiml(res);
}
