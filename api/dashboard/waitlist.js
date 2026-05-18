/**
 * GET  /api/dashboard/waitlist  — fetch all waitlist entries (with optional filters)
 * PATCH /api/dashboard/waitlist  — mark entry/entries as contacted
 *
 * Query params (GET):
 *   ?priority=urgent|routine
 *   ?contacted=true|false
 *   ?days=30   (default: all time)
 *
 * Body (PATCH): { ids: string[], contacted: boolean }
 */

import { supabase } from '../../lib/supabase.js';
import { requireAuth } from '../../lib/auth.js';

export default async function handler(req, res) {
  const payload = requireAuth(req, res);
  if (!payload) return; // requireAuth already sent 401

  if (req.method === 'GET') {
    return handleGet(req, res);
  }
  if (req.method === 'PATCH') {
    return handlePatch(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req, res) {
  let query = supabase
    .from('waitlist')
    .select('*')
    .order('created_at', { ascending: false });

  const { priority, contacted, days } = req.query;

  if (priority === 'urgent' || priority === 'routine') {
    query = query.eq('priority', priority);
  }
  if (contacted === 'true')  query = query.eq('contacted', true);
  if (contacted === 'false') query = query.eq('contacted', false);

  if (days && !isNaN(Number(days))) {
    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte('created_at', since);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Dashboard waitlist GET error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  // Stats for dashboard header
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

  return res.status(200).json({
    entries: data,
    stats: {
      totalThisMonth: monthCount ?? 0,
      urgentPending:  urgentCount ?? 0,
      totalShown:     data.length,
    },
  });
}

async function handlePatch(req, res) {
  const { ids, contacted } = req.body ?? {};

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array is required' });
  }
  if (typeof contacted !== 'boolean') {
    return res.status(400).json({ error: 'contacted boolean is required' });
  }

  const { error } = await supabase
    .from('waitlist')
    .update({ contacted })
    .in('id', ids);

  if (error) {
    console.error('Dashboard waitlist PATCH error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  return res.status(200).json({ updated: ids.length });
}
