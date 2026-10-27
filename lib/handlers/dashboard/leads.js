/**
 * /api/dashboard/leads[?adminClientId=]
 *   GET    the lead inbox (last 100) + this month's speed-to-lead numbers
 *   PATCH  { id, status, appointment_at? }  move a lead along; the status's
 *          automations run (follow-ups, reminders, review requests)
 *   POST   { name?, phone?, email?, message? }  add a lead by hand (no auto-text)
 */

import { supabase }    from '../../supabase.js';
import { requireAuth } from '../../auth.js';
import { createLead, setLeadStatus } from '../../leads.js';

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

export default async function handler(req, res) {
  const payload = requireAuth(req, res);
  if (!payload) return;
  const isAdmin  = payload.role === 'admin';
  const clientId = isAdmin ? (req.query.adminClientId || req.body?.client_id || null) : payload.client_id;
  if (!clientId) return res.status(400).json({ error: 'Pick a client first' });

  const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).maybeSingle();
  if (!client) return res.status(404).json({ error: 'Client not found' });

  if (req.method === 'GET') return list(res, client);
  if (req.method === 'PATCH') return patch(req, res, client);
  if (req.method === 'POST') return add(req, res, client);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function list(res, client) {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const [recent, month] = await Promise.all([
    supabase.from('client_leads')
      .select('id, source, name, phone, email, message, status, appointment_at, received_at, first_response_at')
      .eq('client_id', client.id).order('received_at', { ascending: false }).limit(100),
    supabase.from('client_leads').select('source, received_at, first_response_at')
      .eq('client_id', client.id).gte('received_at', monthStart),
  ]);
  if (recent.error) {
    // sql/019 not run yet — hide the section rather than error.
    return res.status(200).json({ leads: [], stats: null, setupNeeded: true });
  }
  const m = month.data ?? [];
  // Speed-to-lead counts leads that came from outside the phone line.
  const outside = m.filter((l) => l.source !== 'call');
  const secs = outside.filter((l) => l.first_response_at)
    .map((l) => Math.max(0, (new Date(l.first_response_at) - new Date(l.received_at)) / 1000));
  const bySource = m.reduce((acc, l) => ({ ...acc, [l.source]: (acc[l.source] ?? 0) + 1 }), {});
  return res.status(200).json({
    leads: recent.data ?? [],
    stats: {
      thisMonth: m.length,
      bySource,
      medianResponseSeconds: median(secs),
      under5min: secs.filter((s) => s <= 300).length,
      outsideLeads: outside.length,
    },
  });
}

async function patch(req, res, client) {
  const { id, status, appointment_at: appointmentAt } = req.body ?? {};
  const { data: lead } = await supabase.from('client_leads').select('*').eq('id', id).eq('client_id', client.id).maybeSingle();
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const extra = {};
  if (appointmentAt !== undefined) {
    const t = appointmentAt ? new Date(appointmentAt) : null;
    if (t && Number.isNaN(t.getTime())) return res.status(400).json({ error: 'appointment_at is not a date' });
    extra.appointment_at = t ? t.toISOString() : null;
  }
  try {
    const out = await setLeadStatus(client, lead, status ?? lead.status, extra);
    return res.status(200).json(out);
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message });
  }
}

async function add(req, res, client) {
  const b = req.body ?? {};
  try {
    const { lead, duplicate } = await createLead(client, { ...b, source: 'manual' });
    return res.status(200).json({ lead, duplicate });
  } catch (err) {
    return res.status(err.status ?? 500).json({ error: err.message });
  }
}
