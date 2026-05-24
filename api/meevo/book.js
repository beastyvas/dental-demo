/**
 * POST /api/meevo/book
 * Vapi tool: `bookAppointment`
 * Mock Meevo integration — generates a confirmation number and logs
 * the booking to the waitlist table so it appears in the dashboard.
 */

import { supabase }           from '../../lib/supabase.js';
import { verifyVapiRequest }  from '../../lib/vapi.js';
import { getClientByAgentId } from '../../lib/clients.js';
import { formatInTZ, TIMEZONE } from '../../lib/timezone.js';

function confirmationNumber() {
  return 'ME-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyVapiRequest(req, res)) return;

  try {
    const body        = req.body;
    const assistantId = body?.message?.call?.assistantId;
    const client      = await getClientByAgentId(assistantId);
    const tz          = client?.timezone ?? TIMEZONE;

    let args;
    if (body?.message?.toolCalls?.[0]?.function?.arguments) {
      args = body.message.toolCalls[0].function.arguments;
    } else {
      args = body;
    }

    const {
      guest_name,
      phone,
      service,
      slot_description,
      notes = '',
    } = args;

    if (!guest_name || !phone || !service || !slot_description) {
      return res.status(400).json({
        error: 'guest_name, phone, service, and slot_description are required',
      });
    }

    const confNum = confirmationNumber();
    const bookedAt = formatInTZ(new Date(), {}, tz);

    const { error } = await supabase.from('waitlist').insert([{
      client_id:      client?.id ?? null,
      patient_name:   guest_name.trim(),
      phone:          phone.trim(),
      service_needed: service.trim(),
      preferred_days:  slot_description.trim(),
      preferred_times: '',
      priority:       'routine',
      notes:          `CONFIRMED via AI — ${slot_description} | Conf#: ${confNum} | Booked: ${bookedAt}${notes ? ' | ' + notes : ''}`,
      contacted:      false,
    }]);

    if (error) {
      console.error('[meevo/book] Supabase insert error:', error);
      return res.status(500).json({ error: 'Failed to save booking' });
    }

    const toolCallId = body?.message?.toolCalls?.[0]?.id ?? 'direct-call';

    console.log(`[meevo/book] Booked: ${guest_name} | ${service} | ${slot_description} | ${confNum} | client=${client?.slug ?? 'unknown'}`);

    return res.status(200).json({
      results: [{
        toolCallId,
        result: JSON.stringify({
          confirmation_number: confNum,
          guest_name,
          appointment: slot_description,
          service,
          message: `Appointment confirmed. Confirmation number: ${confNum}.`,
        }),
      }],
    });
  } catch (err) {
    console.error('[meevo/book] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
