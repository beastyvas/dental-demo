/**
 * GET  /api/review?id=<requestId>  — public, no auth. Loads the review
 *      request's business info for the caller-facing page and marks it
 *      as clicked.
 * POST /api/review                 — public, no auth. Body: { id, rating?,
 *      name?, feedback? }. Updates the request with whichever fields are
 *      present — the rating page sends { id, rating }, the feedback page
 *      sends { id, name, feedback }.
 */

import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'GET')  return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const { data: request, error } = await supabase
    .from('review_requests')
    .select('id, patient_name, rating, clicked, clients(business_name, google_review_link)')
    .eq('id', id)
    .single();

  if (error || !request) {
    return res.status(404).json({ error: 'Review request not found' });
  }

  if (!request.clicked) {
    await supabase.from('review_requests').update({ clicked: true }).eq('id', id);
  }

  return res.status(200).json({
    patient_name:       request.patient_name,
    rating:              request.rating,
    business_name:       request.clients?.business_name ?? null,
    google_review_link:  request.clients?.google_review_link ?? null,
  });
}

async function handlePost(req, res) {
  const { id, rating, name, feedback } = req.body ?? {};
  if (!id) return res.status(400).json({ error: 'id is required' });

  const update = {};
  if (rating !== undefined) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'rating must be an integer 1-5' });
    }
    update.rating = rating;
  }
  if (name !== undefined)     update.patient_name = String(name).trim();
  if (feedback !== undefined) update.feedback      = String(feedback).trim();

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  const { error } = await supabase
    .from('review_requests')
    .update(update)
    .eq('id', id);

  if (error) {
    console.error('[review] update error:', error);
    return res.status(500).json({ error: 'Database error' });
  }

  return res.status(200).json({ ok: true });
}
