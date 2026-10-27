/**
 * GET /api/cron/followups — every 5 minutes (vercel.json). Sends the
 * scheduled texts that are due: estimate follow-ups, reminders, review
 * requests, reactivation. See lib/followups.js.
 */

import { processDue } from '../../followups.js';

export default async function handler(req, res) {
  try {
    // A few batches per run so a reactivation campaign can't starve reminders.
    const total = { sent: 0, deferred: 0, skipped: 0, cancelled: 0, failed: 0 };
    for (let i = 0; i < 4; i++) {
      const r = await processDue({ limit: 50 });
      for (const k of Object.keys(total)) total[k] += r[k];
      if (Object.values(r).reduce((a, b) => a + b, 0) < 50) break;
    }
    return res.status(200).json(total);
  } catch (err) {
    console.error('[cron/followups]', err);
    return res.status(500).json({ error: err.message });
  }
}
