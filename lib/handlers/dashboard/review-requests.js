/**
 * GET  /api/dashboard/review-requests  — recent review requests + stats
 *      Scoping: role=client → own client_id. role=admin → adminClientId query param.
 * POST /api/dashboard/review-requests  — client role only. Creates a
 *      review_requests row and sends the review-request SMS.
 */

import { supabase }    from '../../supabase.js';
import { requireAuth } from '../../auth.js';
import { sendReviewRequest } from '../../reviews.js';

export default async function handler(req, res) {
  const payload = requireAuth(req, res);
  if (!payload) return;

  if (req.method === 'GET')  return handleGet(req, res, payload);
  if (req.method === 'POST') return handlePost(req, res, payload);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req, res, payload) {
  const isAdmin  = payload.role === 'admin';
  const clientId = isAdmin ? req.query.adminClientId : payload.client_id;

  if (!clientId) {
    return res.status(400).json({ error: 'adminClientId is required for admin requests' });
  }

  const { data: entries, error } = await supabase
    .from('review_requests')
    .select('id, patient_name, patient_phone, sent_at, clicked, rating, feedback')
    .eq('client_id', clientId)
    .order('sent_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[review-requests] GET error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  const rated      = entries.filter(e => e.rating != null);
  const breakdown  = [1, 2, 3, 4, 5].map(n => rated.filter(e => e.rating === n).length);
  const avgRating  = rated.length ? rated.reduce((s, e) => s + e.rating, 0) / rated.length : null;

  return res.status(200).json({
    entries,
    stats: {
      sent:      entries.length,
      clicked:   entries.filter(e => e.clicked).length,
      rated:     rated.length,
      avgRating: avgRating != null ? Math.round(avgRating * 10) / 10 : null,
      breakdown, // [count of 1★, 2★, 3★, 4★, 5★]
    },
  });
}

async function handlePost(req, res, payload) {
  if (payload.role !== 'client') {
    return res.status(403).json({ error: 'Only a business account can send review requests' });
  }

  const { patient_name, patient_phone } = req.body ?? {};
  if (!patient_phone) {
    return res.status(400).json({ error: 'patient_phone is required' });
  }

  const { data: client } = await supabase.from('clients')
    .select('id, business_name, review_provider_name, twilio_number').eq('id', payload.client_id).single();
  try {
    const out = await sendReviewRequest(client ?? { id: payload.client_id, business_name: payload.business_name }, {
      name: patient_name, phone: patient_phone.trim(),
    });
    if (!out.smsSent) console.error('[review-requests] SMS failed:', out.smsError);
    return res.status(200).json({ request: out.request, smsSent: out.smsSent, ...(out.smsSent ? {} : { smsError: out.smsError }) });
  } catch (err) {
    console.error('[review-requests] insert error:', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
}
