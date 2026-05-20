/**
 * GET    /api/dashboard/waitlist  — fetch waitlist entries
 * PATCH  /api/dashboard/waitlist  — mark entries as scheduled (contacted=true)
 * DELETE /api/dashboard/waitlist  — hard-delete entries
 *
 * Scoping:
 *   role=client → entries filtered to payload.client_id
 *   role=admin  → all entries across all clients; includes business_name
 */

import { supabase }     from '../../lib/supabase.js';
import { requireAuth }  from '../../lib/auth.js';

export default async function handler(req, res) {
  const payload = requireAuth(req, res);
  if (!payload) return;

  if (req.method === 'GET')    return handleGet(req, res, payload);
  if (req.method === 'PATCH')  return handlePatch(req, res, payload);
  if (req.method === 'DELETE') return handleDelete(req, res, payload);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req, res, payload) {
  const { priority, showScheduled, days } = req.query;
  const isAdmin  = payload.role === 'admin';
  const clientId = payload.client_id;

  // Admin sees business_name via FK join; client sees own entries only
  let query = supabase
    .from('waitlist')
    .select(isAdmin ? '*, clients(business_name)' : '*')
    .order('priority',   { ascending: false })
    .order('created_at', { ascending: false });

  if (!isAdmin) {
    query = query.eq('client_id', clientId);
  }

  if (showScheduled !== 'true') {
    query = query.eq('contacted', false);
  }

  if (priority === 'urgent' || priority === 'routine') {
    query = query.eq('priority', priority);
  }

  if (days && !isNaN(Number(days))) {
    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte('created_at', since);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Dashboard waitlist GET error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  // Flatten the FK join result for admin rows
  const entries = (data ?? []).map(e => {
    if (!isAdmin) return e;
    const { clients, ...rest } = e;
    return { ...rest, business_name: clients?.business_name ?? null };
  });

  // Stats queries — scoped same as entries
  const now      = new Date();
  const monthAgo = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  function buildStatsQuery() {
    let q = supabase.from('waitlist').select('*', { count: 'exact', head: true });
    if (!isAdmin) q = q.eq('client_id', clientId);
    return q;
  }

  const [{ count: monthCount }, { count: urgentCount }, { count: scheduledCount }] = await Promise.all([
    buildStatsQuery().gte('created_at', monthAgo),
    buildStatsQuery().eq('priority', 'urgent').eq('contacted', false),
    buildStatsQuery().eq('contacted', true).gte('created_at', monthAgo),
  ]);

  return res.status(200).json({
    entries,
    stats: {
      totalThisMonth:  monthCount    ?? 0,
      urgentPending:   urgentCount   ?? 0,
      scheduledMonth:  scheduledCount ?? 0,
    },
  });
}

async function handlePatch(req, res, payload) {
  const { ids } = req.body ?? {};

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array is required' });
  }

  // Scope the update to the client's own rows unless admin
  let query = supabase
    .from('waitlist')
    .update({ contacted: true })
    .in('id', ids);

  if (payload.role !== 'admin') {
    query = query.eq('client_id', payload.client_id);
  }

  const { error } = await query;

  if (error) {
    console.error('Dashboard waitlist PATCH error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  return res.status(200).json({ updated: ids.length });
}

async function handleDelete(req, res, payload) {
  const { ids } = req.body ?? {};

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array is required' });
  }

  let query = supabase
    .from('waitlist')
    .delete()
    .in('id', ids);

  if (payload.role !== 'admin') {
    query = query.eq('client_id', payload.client_id);
  }

  const { error } = await query;

  if (error) {
    console.error('Dashboard waitlist DELETE error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  return res.status(200).json({ deleted: ids.length });
}
