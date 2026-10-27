/**
 * Review requests: a review_requests row + a text linking to the rating page
 * (/review/:id). Used by the dashboard's "send a review request" form and by
 * the after-job automation (lib/statusAutomations.js → followups).
 */

import { supabase } from './supabase.js';
import { sendSMS, canUseTwilio } from './sms.js';
import { toE164 } from './phone.js';

const base = () => process.env.DASHBOARD_URL
  || (process.env.VERCEL_DOMAIN ? `https://${process.env.VERCEL_DOMAIN.replace(/^https?:\/\//, '')}` : null);

/** Returns { request, smsSent, smsError? }. Throws only if the row can't be saved. */
export async function sendReviewRequest(client, { name = null, phone }) {
  const cleanName = name?.trim() || null;
  const { data: request, error } = await supabase.from('review_requests').insert([{
    client_id: client.id,
    patient_name: cleanName,
    patient_phone: toE164(phone) ?? String(phone).trim(),
  }]).select().single();
  if (error) throw new Error(`review request not saved: ${error.message}`);

  // With Twilio the text links straight to the rating page, which shows the
  // Google link for every rating. TextBelt can't send links, so without
  // Twilio we spell out the ask instead.
  const greeting = cleanName ? `Hi ${cleanName}!` : 'Hi there!';
  const shoutout = client.review_provider_name
    ? ` If you could mention ${client.review_provider_name} by name in your review, it'd mean so much to her!`
    : '';
  const message = canUseTwilio(client) && base()
    ? `${greeting} Thanks for choosing ${client.business_name}. How did we do? It takes 10 seconds: ${base()}/review/${request.id}${shoutout} Reply STOP to opt out.`
    : `${greeting} Thank you for visiting ${client.business_name} today. `
      + `We'd love it if you could search "${client.business_name}" on Google and leave us a review!${shoutout}`;

  try {
    await sendSMS(phone, message, { client, kind: 'review' });
    return { request, smsSent: true };
  } catch (err) {
    return { request, smsSent: false, smsError: err.message, optedOut: Boolean(err.optedOut) };
  }
}
