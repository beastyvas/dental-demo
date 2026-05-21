/**
 * POST /api/auth
 * Multi-tenant login endpoint.
 * Body: { password: string }
 *
 * Auth order:
 *   1. ADMIN_PASSWORD env var → { role: 'admin' }
 *   2. clients.dashboard_password match → { role: 'client', client_id, business_name }
 *   3. → 401
 */

import { signToken } from '../lib/auth.js';
import { supabase }  from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body ?? {};
  if (!password) {
    return res.status(400).json({ error: 'password is required' });
  }

  // 1. Platform admin check
  const adminPw = process.env.ADMIN_PASSWORD;
  if (adminPw && password === adminPw) {
    const token = signToken({ role: 'admin' });
    return res.status(200).json({ token, role: 'admin', business_name: 'Admin' });
  }

  // 2. Client password check
  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('id, business_name')
    .eq('dashboard_password', password)
    .eq('active', true)
    .maybeSingle();

  if (clientErr) {
    console.error('clients query error:', clientErr);
    return res.status(500).json({ error: 'Database error — check Vercel logs' });
  }

  if (client) {
    const token = signToken({ role: 'client', client_id: client.id, business_name: client.business_name });
    return res.status(200).json({ token, role: 'client', business_name: client.business_name });
  }

  await new Promise(r => setTimeout(r, 300));
  return res.status(401).json({ error: 'Invalid password' });
}
