/**
 * GET /api/office-status  (also accepts POST from Vapi tool calls)
 * Called by the `checkOfficeHours` Vapi tool at the start of every call.
 * Returns current office open/closed status in Las Vegas time.
 * No auth required — office hours is public information.
 */

import { getOfficeStatus } from '../lib/businessHours.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const status = getOfficeStatus();

    const toolCallId = req.body?.message?.toolCalls?.[0]?.id ?? 'direct-call';

    return res.status(200).json({
      results: [{
        toolCallId,
        result: JSON.stringify(status),
      }],
    });
  } catch (err) {
    console.error('office-status error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
