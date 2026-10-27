/**
 * /api/cron/:job — scheduled jobs behind one function (Hobby plan function
 * cap). Vercel cron sends `Authorization: Bearer $CRON_SECRET`.
 */

import morningSummary from '../../lib/handlers/cron/morning-summary.js';
import followups      from '../../lib/handlers/cron/followups.js';
import scorecard      from '../../lib/handlers/cron/scorecard.js';

const JOBS = {
  'morning-summary': morningSummary,
  'followups':       followups,
  'scorecard':       scorecard,
};

export default async function handler(req, res) {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const run = JOBS[req.query.job];
  if (!run) return res.status(404).json({ error: `Unknown job: ${req.query.job}` });
  return run(req, res);
}
