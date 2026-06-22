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

  if (req.method === 'PATCH') return handlePatch(req, res, payload);

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

      let reviewStats = null;
      if (client.review_funnel_enabled) {
        const { data: reviews } = await supabase.from('review_requests')
          .select('clicked, rating').eq('client_id', client.id);
        const rated = (reviews ?? []).filter(r => r.rating != null);
        reviewStats = {
          sent:      reviews?.length ?? 0,
          clicked:   reviews?.filter(r => r.clicked).length ?? 0,
          avgRating: rated.length ? Math.round((rated.reduce((s, r) => s + r.rating, 0) / rated.length) * 10) / 10 : null,
        };
      }

      return {
        ...client,
        stats: {
          activeLeads:  activeleads  ?? 0,
          urgentActive: urgent       ?? 0,
          monthLeads:   monthLeads   ?? 0,
          lastActivity: lastEntry?.created_at ?? null,
        },
        reviewStats,
      };
    })
  );

  return res.status(200).json({ clients: withStats });
}

/**
 * PATCH /api/dashboard/clients
 * Admin → can update any client: review_funnel_enabled, google_review_link,
 *   assistant_active. Body: { client_id, ...fields }
 * Client → can only flip their OWN assistant_active (the on/off receptionist
 *   toggle). client_id is forced from the JWT, not the request body.
 * Body: { assistant_active? }
 */
async function handlePatch(req, res, payload) {
  const isAdmin  = payload.role === 'admin';
  const body     = req.body ?? {};
  const clientId = isAdmin ? body.client_id : payload.client_id;

  if (!clientId) {
    return res.status(400).json({ error: 'client_id is required' });
  }

  const update = {};
  if (isAdmin) {
    if (body.review_funnel_enabled !== undefined) update.review_funnel_enabled = !!body.review_funnel_enabled;
    if (body.google_review_link    !== undefined) update.google_review_link    = body.google_review_link?.trim() || null;
  }
  if (body.assistant_active !== undefined) {
    if (typeof body.assistant_active !== 'boolean') {
      return res.status(400).json({ error: 'assistant_active must be a boolean' });
    }
    update.assistant_active = body.assistant_active;
  }

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const { data, error } = await supabase
    .from('clients')
    .update(update)
    .eq('id', clientId)
    .select('id, review_funnel_enabled, google_review_link, assistant_active')
    .single();

  if (error) {
    console.error('[dashboard/clients] PATCH error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  return res.status(200).json({ client: data });
}
