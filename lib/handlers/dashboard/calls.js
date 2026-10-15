/**
 * GET /api/dashboard/calls[?adminClientId=]
 * The call log + this month's numbers, including the guarantee counter
 * (qualified leads captured) and minutes used vs the plan's included minutes.
 */

import { supabase }     from '../../supabase.js';
import { requireAuth }  from '../../auth.js';
import { LEAD_OUTCOMES } from '../../calls.js';

export default async function handler(req, res) {
  const payload = requireAuth(req, res);
  if (!payload) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const isAdmin  = payload.role === 'admin';
  const clientId = isAdmin ? (req.query.adminClientId || null) : payload.client_id;
  if (!clientId) return res.status(400).json({ error: 'Pick a client first' });

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [recent, month, client] = await Promise.all([
    supabase.from('calls')
      .select('id, caller_phone, caller_name, started_at, duration_seconds, outcome, summary, need, transcript, recording_url, after_hours, text_back_sent')
      .eq('client_id', clientId).order('started_at', { ascending: false }).limit(50),
    supabase.from('calls')
      .select('outcome, duration_seconds, after_hours, text_back_sent')
      .eq('client_id', clientId).gte('started_at', monthStart),
    supabase.from('clients').select('included_minutes, plan').eq('id', clientId).maybeSingle(),
  ]);

  if (recent.error || month.error) {
    // Most likely sql/017 hasn't been run yet — show an empty log, not an error page.
    console.error('[dashboard/calls] query error:', recent.error ?? month.error);
    return res.status(200).json({ calls: [], stats: null, setupNeeded: true });
  }

  const m = month.data ?? [];
  const seconds = m.reduce((s, c) => s + (c.duration_seconds ?? 0), 0);
  const stats = {
    answered:        m.filter((c) => c.outcome !== 'spam').length,
    afterHours:      m.filter((c) => c.after_hours && c.outcome !== 'spam').length,
    leadsCaptured:   m.filter((c) => LEAD_OUTCOMES.has(c.outcome)).length,
    booked:          m.filter((c) => c.outcome === 'booked').length,
    textBacks:       m.filter((c) => c.text_back_sent).length,
    minutesUsed:     Math.ceil(seconds / 60),
    includedMinutes: client.data?.included_minutes ?? null,
  };

  return res.status(200).json({ calls: recent.data ?? [], stats });
}
