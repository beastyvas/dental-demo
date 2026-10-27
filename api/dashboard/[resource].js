/**
 * /api/dashboard/:resource — the dashboard's data endpoints behind one function
 * (Hobby plan function cap). Handlers live in lib/handlers/dashboard/.
 */

import clients        from '../../lib/handlers/dashboard/clients.js';
import waitlist       from '../../lib/handlers/dashboard/waitlist.js';
import reviewRequests from '../../lib/handlers/dashboard/review-requests.js';
import calls          from '../../lib/handlers/dashboard/calls.js';
import leads          from '../../lib/handlers/dashboard/leads.js';
import scorecard      from '../../lib/handlers/dashboard/scorecard.js';

const RESOURCES = {
  'clients':         clients,
  'waitlist':        waitlist,
  'review-requests': reviewRequests,
  'calls':           calls,
  'leads':           leads,
  'scorecard':       scorecard,
};

export default async function handler(req, res) {
  const run = RESOURCES[req.query.resource];
  if (!run) return res.status(404).json({ error: `Unknown resource: ${req.query.resource}` });
  return run(req, res);
}
