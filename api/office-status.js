/**
 * GET /api/office-status  (also accepts POST from Vapi tool calls)
 * Called by the `checkOfficeHours` Vapi tool at the start of every call.
 * Multi-tenant: uses the client's timezone from the clients table.
 * No auth required — office hours is public information.
 */

import { getOfficeStatus } from '../lib/businessHours.js';
import { getClientByAgentId } from '../lib/clients.js';
import { TIMEZONE } from '../lib/timezone.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Resolve client timezone from the calling agent's ID
    const assistantId = req.body?.message?.call?.assistantId;
    const client      = await getClientByAgentId(assistantId);
    const timezone    = client?.timezone ?? TIMEZONE;

    const status          = getOfficeStatus(timezone);
    const assistantActive = client?.assistant_active !== false; // default true if client unresolved
    const toolCallId      = req.body?.message?.toolCalls?.[0]?.id ?? 'direct-call';

    return res.status(200).json({
      results: [{
        toolCallId,
        result: JSON.stringify({ ...status, assistantActive }),
      }],
    });
  } catch (err) {
    console.error('office-status error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
