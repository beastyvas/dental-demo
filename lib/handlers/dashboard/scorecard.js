/**
 * GET /api/dashboard/scorecard[?month=YYYY-MM][&adminClientId=]
 * The monthly scorecard (default: this month so far).
 */

import { supabase }    from '../../supabase.js';
import { requireAuth } from '../../auth.js';
import { computeScorecard } from '../../scorecard.js';

export default async function handler(req, res) {
  const payload = requireAuth(req, res);
  if (!payload) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const clientId = payload.role === 'admin' ? (req.query.adminClientId || null) : payload.client_id;
  if (!clientId) return res.status(400).json({ error: 'Pick a client first' });
  const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).maybeSingle();
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const tz = client.timezone || 'America/Los_Angeles';
  const thisMonth = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month ?? '')) ? req.query.month : thisMonth;
  try {
    return res.status(200).json({ scorecard: await computeScorecard(client, month), thisMonth });
  } catch (err) {
    return res.status(200).json({ scorecard: null, setupNeeded: true, error: err.message });
  }
}
