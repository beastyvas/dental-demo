/**
 * POST /api/auth
 * Multi-tenant login endpoint.
 * Body: { password: string }
 *
 * Auth order:
 *   1. ADMIN_PASSWORD env var → { role: 'admin' }
 *   2. clients.dashboard_password match → { role: 'client', client_id, business_name }
 *   3. → 401
 *
 * Rate limiting: 10 failed attempts per IP per 15 minutes → 429
 */

import { signToken } from '../lib/auth.js';
import { supabase }  from '../lib/supabase.js';

// In-memory rate limiter — per function instance (sufficient for demo scale)
// For distributed rate limiting at scale, swap this for Vercel KV / Upstash Redis
const failMap = new Map(); // ip → { count, windowStart }
const MAX_FAILS  = 10;
const WINDOW_MS  = 15 * 60 * 1000; // 15 minutes

function getIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return (forwarded ? forwarded.split(',')[0] : req.socket?.remoteAddress ?? 'unknown').trim();
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = failMap.get(ip);
  if (!entry) return false;
  if (now - entry.windowStart > WINDOW_MS) {
    failMap.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILS;
}

function recordFail(ip) {
  const now = Date.now();
  const entry = failMap.get(ip);
  if (!entry || Date.now() - entry.windowStart > WINDOW_MS) {
    failMap.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

function clearFail(ip) {
  failMap.delete(ip);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = getIp(req);

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  }

  const { password } = req.body ?? {};
  if (!password) {
    return res.status(400).json({ error: 'password is required' });
  }

  // 1. Platform admin check
  const adminPw = process.env.ADMIN_PASSWORD;
  if (adminPw && password === adminPw) {
    clearFail(ip);
    const token = signToken({ role: 'admin' });
    return res.status(200).json({ token, role: 'admin', business_name: 'Admin' });
  }

  // 2. Client password check
  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('id, business_name, demo_phone, review_funnel_enabled, review_only_dashboard')
    .eq('dashboard_password', password)
    .eq('active', true)
    .maybeSingle();

  if (clientErr) {
    console.error('clients query error:', clientErr);
    return res.status(500).json({ error: 'Database error — check Vercel logs' });
  }

  if (client) {
    clearFail(ip);
    const token = signToken({ role: 'client', client_id: client.id, business_name: client.business_name });
    return res.status(200).json({
      token,
      role: 'client',
      business_name: client.business_name,
      demo_phone: client.demo_phone ?? null,
      review_funnel_enabled: client.review_funnel_enabled ?? false,
      review_only_dashboard: client.review_only_dashboard ?? false,
    });
  }

  // Failed — record and delay
  recordFail(ip);
  await new Promise(r => setTimeout(r, 300));
  return res.status(401).json({ error: 'Invalid password' });
}
