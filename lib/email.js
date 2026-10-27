/**
 * Email via Resend (optional). Env: RESEND_API_KEY, RESEND_FROM (a sender on
 * a domain verified in Resend). Used for the monthly scorecard copy.
 */

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);

export async function sendEmail({ to, subject, text }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.RESEND_FROM, to: [to], subject, text }),
  });
  if (!r.ok) throw new Error(`Email failed: ${await r.text()}`);
  return r.json();
}
