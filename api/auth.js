/**
 * POST /api/auth
 * Dashboard login endpoint.
 * Body: { password: string }
 * Returns: { token: string } — JWT valid for 12h
 */

import { signToken } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body ?? {};

  if (!password) {
    return res.status(400).json({ error: 'password is required' });
  }

  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) {
    return res.status(500).json({ error: 'DASHBOARD_PASSWORD not configured' });
  }

  if (password !== expected) {
    // Constant-time comparison isn't critical here (not a high-security app),
    // but add a small delay to slow brute force
    await new Promise(r => setTimeout(r, 300));
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = signToken({ role: 'dashboard' });
  return res.status(200).json({ token });
}
