import twilio from 'twilio';

let _client;

function getClient() {
  if (!_client) {
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
    _client = twilio(sid, token);
  }
  return _client;
}

/**
 * Send an SMS via Twilio.
 * @param {string} to   - E.164 number, e.g. "+17025551234"
 * @param {string} body - Message text
 */
export async function sendSMS(to, body) {
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) throw new Error('Missing TWILIO_FROM_NUMBER');

  const message = await getClient().messages.create({ to, from, body });
  console.log(`SMS sent to ${to} — SID: ${message.sid}`);
  return message;
}
