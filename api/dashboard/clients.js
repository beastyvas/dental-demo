/**
 * GET /api/dashboard/clients
 * Admin-only endpoint — returns all active clients.
 */

import { requireAuth }        from '../../lib/auth.js';
import { getAllActiveClients } from '../../lib/clients.js';

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

  // Strip dashboard_password from the response
  const safe = clients.map(({ dashboard_password, ...rest }) => rest);

  return res.status(200).json({ clients: safe });
}
