/**
 * GET    /api/dashboard/waitlist  — fetch waitlist entries
 * PATCH  /api/dashboard/waitlist  — mark entry/entries as scheduled (contacted=true)
 * DELETE /api/dashboard/waitlist  — hard-delete entry/entries
 *
 * Query params (GET):
 *   ?priority=urgent|routine
 *   ?showScheduled=true   (default: only active/unscheduled)
 *   ?days=30
 *
 * Body (PATCH):  { ids: string[] }
 * Body (DELETE): { ids: string[] }
 */

import { supabase } from '../../lib/supabase.js';
import { requireAuth } from '../../lib/auth.js';

export default async function handler(req, res) {
  const payload = requireAuth(req, res);
  if (!payload) return;

  if (req.method === 'GET')    return handleGet(req, res);
  if (req.method === 'PATCH')  return handlePatch(req, res);
  if (req.method === 'DELETE') return handleDelete(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req, res) {
  const { priority, showScheduled, days } = req.query;

  let query = supabase
    .from('waitlist')
    .select('*')
    .order('priority', { ascending: false })  // urgent first (desc: u > r)
    .order('created_at', { ascending: false });

  // Default: only show active (unscheduled) leads
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

  const now      = new Date();
  const monthAgo = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { count: monthCount } = await supabase
    .from('waitlist')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', monthAgo);

  const { count: urgentCount } = await supabase
    .from('waitlist')
    .select('*', { count: 'exact', head: true })
    .eq('priority', 'urgent')
    .eq('contacted', false);

  const { count: scheduledCount } = await supabase
    .from('waitlist')
    .select('*', { count: 'exact', head: true })
    .eq('contacted', true)
    .gte('created_at', monthAgo);

  return res.status(200).json({
    entries: data,
    stats: {
      totalThisMonth:  monthCount   ?? 0,
      urgentPending:   urgentCount  ?? 0,
      scheduledMonth:  scheduledCount ?? 0,
    },
  });
}

async function handlePatch(req, res) {
  const { ids } = req.body ?? {};

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array is required' });
  }

  const { error } = await supabase
    .from('waitlist')
    .update({ contacted: true })
    .in('id', ids);

  if (error) {
    console.error('Dashboard waitlist PATCH error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  return res.status(200).json({ updated: ids.length });
}

async function handleDelete(req, res) {
  const { ids } = req.body ?? {};

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array is required' });
  }

  const { error } = await supabase
    .from('waitlist')
    .delete()
    .in('id', ids);

  if (error) {
    console.error('Dashboard waitlist DELETE error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  return res.status(200).json({ deleted: ids.length });
}
