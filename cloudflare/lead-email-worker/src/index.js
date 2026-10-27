/**
 * Cloudflare Email Worker — every email sent to <slug>.<key>@leads.<domain>
 * (Angi, Thumbtack, Facebook lead notifications, or anything an owner
 * forwards) is parsed and posted to the receptionist's /api/leads/email,
 * which texts the lead within seconds.
 *
 * Secrets / vars (wrangler secret put …): LEAD_WEBHOOK_URL, LEAD_EMAIL_SECRET.
 * If the webhook is down the email is rejected, so the sender gets a bounce
 * instead of the lead silently disappearing.
 */
import PostalMime from 'postal-mime';

export default {
  async email(message, env) {
    const email = await PostalMime.parse(message.raw);
    const r = await fetch(env.LEAD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-lead-secret': env.LEAD_EMAIL_SECRET },
      body: JSON.stringify({
        to: message.to,
        from: message.from,
        subject: email.subject ?? '',
        text: email.text ?? '',
        html: email.html ?? '',
      }),
    });
    if (r.status === 404) message.setReject('Unknown lead address');
    else if (!r.ok) message.setReject(`Lead webhook failed (${r.status})`);
  },
};
