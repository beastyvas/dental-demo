/**
 * GET /api/cron/a2p — hourly. Moves every in-progress A2P registration a step
 * forward (Twilio approves profiles, brands and campaigns on its own clock).
 */

import { supabase } from '../../supabase.js';
import { advance } from '../../a2p.js';

const IN_PROGRESS = ['profiles_pending', 'brand_pending', 'campaign_pending'];

export default async function handler(req, res) {
  const { data: clients } = await supabase.from('clients').select('*').in('a2p->>status', IN_PROGRESS);
  const results = [];
  for (const client of clients ?? []) {
    const a = await advance(client);
    results.push({ slug: client.slug, status: a.status, error: a.last_error ?? null });
  }
  return res.status(200).json({ results });
}
