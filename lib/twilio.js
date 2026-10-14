/**
 * Minimal Twilio REST client — native fetch, no npm package.
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 */

import crypto from 'node:crypto';

const API = 'https://api.twilio.com/2010-04-01';

export const twilioConfigured = () =>
  Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

function auth() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
  return { sid, header: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') };
}

async function twilio(method, path, params) {
  const { sid, header } = auth();
  const url = `${API}/Accounts/${sid}${path}`;
  const r = await fetch(method === 'GET' && params ? `${url}?${new URLSearchParams(params)}` : url, {
    method,
    headers: { Authorization: header, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : new URLSearchParams(params ?? {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Twilio ${method} ${path} failed (${r.status}): ${data.message ?? JSON.stringify(data)}`);
  return data;
}

/** Send one SMS. Returns the Twilio message resource ({ sid, status, ... }). */
export function sendTwilioSMS({ from, to, body, statusCallback }) {
  return twilio('POST', '/Messages.json', {
    From: from, To: to, Body: body,
    ...(statusCallback ? { StatusCallback: statusCallback } : {}),
  });
}

/** Buy the first available local number in an area code (e.g. "702"). */
export async function buyLocalNumber(areaCode, friendlyName) {
  const { available_phone_numbers: list = [] } = await twilio(
    'GET', '/AvailablePhoneNumbers/US/Local.json',
    { AreaCode: areaCode, SmsEnabled: 'true', VoiceEnabled: 'true', PageSize: '5' },
  );
  if (!list.length) throw new Error(`No Twilio numbers available in area code ${areaCode}`);
  return twilio('POST', '/IncomingPhoneNumbers.json', {
    PhoneNumber: list[0].phone_number,
    FriendlyName: friendlyName ?? list[0].friendly_name,
  });
}

/** Find an owned number's SID by its E.164 value. */
export async function findOwnedNumber(e164) {
  const { incoming_phone_numbers: list = [] } = await twilio('GET', '/IncomingPhoneNumbers.json', { PhoneNumber: e164 });
  return list[0] ?? null;
}

/** Point a number's inbound SMS at our webhook. Voice is left to Vapi. */
export function setSmsWebhook(numberSid, url) {
  return twilio('POST', `/IncomingPhoneNumbers/${numberSid}.json`, { SmsUrl: url, SmsMethod: 'POST' });
}

/**
 * Twilio request signature check (X-Twilio-Signature).
 * signature = base64(HMAC-SHA1(authToken, url + concat(sorted(key + value))))
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export function computeTwilioSignature(authToken, url, params = {}) {
  const data = Object.keys(params).sort().reduce((s, k) => s + k + (params[k] ?? ''), url);
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

export function isValidTwilioSignature({ authToken, signature, url, params }) {
  if (!authToken || !signature) return false;
  const expected = computeTwilioSignature(authToken, url, params);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
