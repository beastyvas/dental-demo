/**
 * /api/tools/:tool — every Vapi tool endpoint behind one serverless function.
 *
 * The Hobby plan caps a deployment at 12 functions, so the handlers live in
 * lib/handlers/ and this file just dispatches. vercel.json rewrites the old
 * URLs (/api/emergency, /api/calendar/book, /api/meevo/:action, …) here, so
 * assistants synced before the move keep working untouched.
 */

import emergency            from '../../lib/handlers/emergency.js';
import officeStatus         from '../../lib/handlers/office-status.js';
import waitlist             from '../../lib/handlers/waitlist.js';
import calendarBook         from '../../lib/handlers/calendar-book.js';
import calendarAvailability from '../../lib/handlers/calendar-availability.js';
import meevo                from '../../lib/handlers/meevo.js';
import patientnow           from '../../lib/handlers/patientnow.js';

const TOOLS = {
  'emergency':             emergency,
  'office-status':         officeStatus,
  'waitlist':              waitlist,
  'calendar-book':         calendarBook,
  'calendar-availability': calendarAvailability,
  'meevo':                 meevo,       // reads req.query.action
  'patientnow':            patientnow,  // reads req.query.action
};

export default async function handler(req, res) {
  const run = TOOLS[req.query.tool];
  if (!run) return res.status(404).json({ error: `Unknown tool: ${req.query.tool}` });
  return run(req, res);
}
