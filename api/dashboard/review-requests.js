/**
 * GET  /api/dashboard/review-requests  — recent review requests + stats
 *      Scoping: role=client → own client_id. role=admin → adminClientId query param.
 * POST /api/dashboard/review-requests  — client role only. Creates a
 *      review_requests row and sends the review-request SMS.
 */

import { supabase }    from '../../lib/supabase.js';
import { requireAuth } from '../../lib/auth.js';
import { sendSMS }     from '../../lib/sms.js';

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

  const name = patient_name?.trim() || null;

  const { data: request, error } = await supabase
    .from('review_requests')
    .insert([{
      client_id:     payload.client_id,
      patient_name:  name,
      patient_phone: patient_phone.trim(),
    }])
    .select()
    .single();

  if (error) {
    console.error('[review-requests] insert error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  const { data: clientRow } = await supabase
    .from('clients')
    .select('review_provider_name')
    .eq('id', payload.client_id)
    .single();

  // No link in the SMS for now — TextBelt requires a verified account to
  // send URLs via text. Spell out the ask instead until that's sorted.
  const greeting = name ? `Hi ${name}!` : 'Hi there!';
  const shoutout = clientRow?.review_provider_name
    ? ` If you could mention ${clientRow.review_provider_name} by name in your review, it'd mean so much to her!`
    : '';
  const message =
    `${greeting} Thank you for visiting ${payload.business_name} today. ` +
    `We'd love it if you could search "${payload.business_name}" on Google and leave us a review!${shoutout}`;

  try {
    await sendSMS(patient_phone, message);
  } catch (smsErr) {
    console.error('[review-requests] SMS failed:', smsErr.message);
    return res.status(200).json({ request, smsSent: false, smsError: smsErr.message });
  }

  return res.status(200).json({ request, smsSent: true });
}
