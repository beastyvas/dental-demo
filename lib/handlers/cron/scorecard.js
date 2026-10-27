/**
 * GET /api/cron/scorecard — 1st of each month (vercel.json). Texts (and
 * emails, if Resend is set up) last month's scorecard to every live Booked
 * Jobs / Full Office owner. Safe to re-run: skips owners already sent one today.
 */

import { supabase } from '../../supabase.js';
import { sendSMS } from '../../sms.js';
import { computeScorecard, previousMonth, scorecardText } from '../../scorecard.js';
import { emailConfigured, sendEmail } from '../../email.js';

const PLANS = ['booked_jobs', 'full_office'];
const dashboardUrl = () =>
  process.env.DASHBOARD_URL || (process.env.VERCEL_DOMAIN ? `https://${process.env.VERCEL_DOMAIN.replace(/^https?:\/\//, '')}` : null);

export default async function handler(req, res) {
  const now = new Date();
  const { data: clients } = await supabase.from('clients').select('*').eq('active', true).eq('status', 'live').in('plan', PLANS);
  const results = [];
  for (const client of clients ?? []) {
    const owner = client.owner_phone ?? client.doctor_phone;
    try {
      const { data: already } = await supabase.from('messages').select('id').eq('client_id', client.id)
        .eq('kind', 'scorecard').gte('created_at', new Date(now.getTime() - 20 * 3_600_000).toISOString()).limit(1);
      if (already?.length) { results.push({ slug: client.slug, skipped: 'already sent' }); continue; }
      const month = previousMonth(now, client.timezone || 'America/Los_Angeles');
      const sc = await computeScorecard(client, month);
      const text = scorecardText(client, sc, dashboardUrl());
      if (owner) await sendSMS(owner, text, { client, kind: 'scorecard', skipOptOutCheck: true });
      const email = client.config?.email;
      if (email && emailConfigured()) {
        await sendEmail({ to: email, subject: `${client.business_name} — your ${month} scorecard`, text }).catch((e) => console.error('[scorecard] email', e.message));
      }
      results.push({ slug: client.slug, month, booked: sc.booked });
    } catch (err) {
      console.error('[scorecard]', client.slug, err.message);
      results.push({ slug: client.slug, error: err.message });
    }
  }
  return res.status(200).json({ results });
}
