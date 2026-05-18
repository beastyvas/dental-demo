/**
 * SMS via TextBelt (https://textbelt.com)
 * No npm package needed — uses native fetch (Node 18+).
 *
 * Keys:
 *   "textbelt"          → free tier, 1 SMS per day total (good for testing)
 *   <your paid key>     → buy at textbelt.com, ~$10 for 50 credits
 *
 * Set TEXTBELT_API_KEY in your env:
 *   - Use "textbelt" for local/demo testing
 *   - Use a real key in production
 */

export async function sendSMS(to, message) {
  const key = process.env.TEXTBELT_API_KEY;
  if (!key) throw new Error('Missing TEXTBELT_API_KEY env var');

  const res = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ phone: to, message, key }),
  });

  const data = await res.json();

  if (!data.success) {
    throw new Error(`TextBelt error: ${data.error ?? 'unknown'} (quota remaining: ${data.quotaRemaining})`);
  }

  console.log(`SMS sent to ${to} — TextBelt ID: ${data.textId}, quota left: ${data.quotaRemaining}`);
  return data;
}
