/**
 * Outbound SMS.
 *
 * Twilio when TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are set — sent from the
 * client's own number (clients.twilio_number), or TWILIO_DEFAULT_FROM for
 * system texts. TextBelt (TEXTBELT_API_KEY) remains as a fallback for setups
 * without Twilio; it can't send links or receive replies.
 *
 * Every send checks opt_outs first (a STOP is honored forever, per client)
 * and is logged to the messages table. Logging is best-effort.
 *
 *   sendSMS(to, body)                                   — legacy call shape still works
 *   sendSMS(to, body, { client, kind, callId, from })
 */

import { toE164 } from './phone.js';
import { twilioConfigured, sendTwilioSMS } from './twilio.js';

// Lazy so pure helpers in this module stay importable without Supabase env (tests).
const db = async () => (await import('./supabase.js')).supabase;

/** Can this client's texts go through Twilio (and so carry links)? */
export const canUseTwilio = (client) =>
  twilioConfigured() && Boolean(client?.twilio_number || process.env.TWILIO_DEFAULT_FROM);

export class OptedOutError extends Error {
  constructor(to) { super(`${to} has opted out of texts`); this.optedOut = true; }
}

export async function isOptedOut(clientId, phone) {
  const e164 = toE164(phone);
  if (!e164) return false;
  let q = (await db()).from('opt_outs').select('id').eq('phone', e164).limit(1);
  q = clientId ? q.eq('client_id', clientId) : q.is('client_id', null);
  const { data } = await q;
  return Boolean(data?.length);
}

async function logMessage(row) {
  try {
    await (await db()).from('messages').insert([row]);
  } catch (err) {
    console.error('[sms] message log failed:', err.message);
  }
}

export async function sendSMS(to, body, { client = null, kind = 'other', callId = null, from = null, skipOptOutCheck = false } = {}) {
  const toE = toE164(to) ?? String(to);

  if (!skipOptOutCheck && await isOptedOut(client?.id ?? null, toE)) {
    throw new OptedOutError(toE);
  }

  // Twilio needs a number to send from; clients onboarded before Twilio (no
  // twilio_number, no TWILIO_DEFAULT_FROM) keep using TextBelt.
  const fromNumber = from ?? client?.twilio_number ?? process.env.TWILIO_DEFAULT_FROM ?? null;
  if (twilioConfigured() && fromNumber) {
    const msg = await sendTwilioSMS({ from: fromNumber, to: toE, body });
    console.log(`SMS sent to ${toE} via Twilio — ${msg.sid}`);
    await logMessage({
      client_id: client?.id ?? null, direction: 'outbound', from_number: fromNumber, to_number: toE,
      body, kind, twilio_sid: msg.sid, status: msg.status, call_id: callId,
    });
    return msg;
  }

  // ── TextBelt fallback ─────────────────────────────────────────────────────
  const key = process.env.TEXTBELT_API_KEY;
  if (!key) throw new Error('No SMS provider configured (set TWILIO_* or TEXTBELT_API_KEY)');

  const res = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ phone: toE, message: body, key }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(`TextBelt error: ${data.error ?? 'unknown'} (quota remaining: ${data.quotaRemaining})`);
  }
  console.log(`SMS sent to ${toE} — TextBelt ID: ${data.textId}, quota left: ${data.quotaRemaining}`);
  await logMessage({
    client_id: client?.id ?? null, direction: 'outbound', from_number: 'textbelt', to_number: toE,
    body, kind, twilio_sid: null, status: 'sent', call_id: callId,
  });
  return data;
}
