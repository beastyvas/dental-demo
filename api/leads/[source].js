/**
 * /api/leads/:source — leads from outside the phone line, behind one function
 * (Hobby plan function cap). See lib/handlers/leads-intake.js.
 */

import { formLead, emailLead } from '../../lib/handlers/leads-intake.js';
import { jobberWebhook, jobberCallback, hcpWebhook, genericJobEvent } from '../../lib/handlers/job-events.js';

const SOURCES = {
  'form':            formLead,
  'email':           emailLead,
  'jobber':          jobberWebhook,
  'jobber-callback': jobberCallback,
  'hcp':             hcpWebhook,
  'job-complete':    genericJobEvent,
};

export default async function handler(req, res) {
  const run = SOURCES[req.query.source];
  if (!run) return res.status(404).json({ error: `Unknown lead source: ${req.query.source}` });
  return run(req, res);
}
