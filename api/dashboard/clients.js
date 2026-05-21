/**
 * GET /api/dashboard/clients
 * Admin-only — returns all active clients with per-client lead stats.
 */

import { requireAuth }        from '../../lib/auth.js';
import { getAllActiveClients } from '../../lib/clients.js';
import { supabase }            from '../../lib/supabase.js';

export default async function handler(req, res) {
  const payload = requireAuth(req, res);
  if (!payload) return;

  if (payload.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clients = await getAllActiveClients();

  const monthAgo = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  // Fetch stats for all clients in parallel
  const withStats = await Promise.all(
    clients.map(async ({ dashboard_password, ...client }) => {
      const [{ count: activeleads }, { count: urgent }, { count: monthLeads }] = await Promise.all([
        supabase.from('waitlist').select('*', { count: 'exact', head: true })
          .eq('client_id', client.id).eq('contacted', false),
        supabase.from('waitlist').select('*', { count: 'exact', head: true })
          .eq('client_id', client.id).eq('priority', 'urgent').eq('contacted', false),
        supabase.from('waitlist').select('*', { count: 'exact', head: true })
          .eq('client_id', client.id).gte('created_at', monthAgo),
      ]);

      const { data: lastEntry } = await supabase.from('waitlist')
        .select('created_at').eq('client_id', client.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();

      return {
        ...client,
        stats: {
          activeLeads:  activeleads  ?? 0,
          urgentActive: urgent       ?? 0,
          monthLeads:   monthLeads   ?? 0,
          lastActivity: lastEntry?.created_at ?? null,
        },
      };
    })
  );

  return res.status(200).json({ clients: withStats });
}
