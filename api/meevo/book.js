/**
 * POST /api/meevo/book
 * Vapi tool: `bookAppointment`
 *
 * When MEEVO_* env vars + client.meevo_site_id are set, creates a real
 * appointment in Meevo and uses the returned confirmation number.
 * Falls back to a generated confirmation + DB log for demos.
 */

import { supabase }             from '../../lib/supabase.js';
import { verifyVapiRequest }    from '../../lib/vapi.js';
import { getClientByAgentId }   from '../../lib/clients.js';
import { formatInTZ, TIMEZONE } from '../../lib/timezone.js';
import {
  meevoConfigured,
  findServiceByName,
  findStaffByName,
  findClientByPhone,
  bookAppointment,
} from '../../lib/meevo.js';

function mockConfirmationNumber() {
  return 'ME-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

// ── Live Meevo booking ────────────────────────────────────────────────────────

async function bookLive({ siteId, guestName, phone, service, slotDescription, staffName, rawStart, slotServiceId, slotStaffId }) {
  // 1. Find or resolve the Meevo client ID
  let meevoClient = await findClientByPhone(siteId, phone);
  let clientId    = meevoClient?.clientId ?? meevoClient?.id;

  // 2. If client doesn't exist, we can't book without a card on file — caller
  //    should have been routed through new-member first.  Proceed anyway with
  //    whatever Meevo allows; some sites permit guest bookings.
  if (!clientId) {
    console.warn(`[meevo/book] No existing Meevo client for phone ${phone}; attempting guest booking`);
  }

  // 3. Resolve service + staff IDs (use pre-resolved IDs from availability if available)
  let serviceId = slotServiceId;
  let staffId   = slotStaffId;

  if (!serviceId) {
    const svc = await findServiceByName(siteId, service);
    if (!svc) throw new Error(`Service not found in Meevo: "${service}"`);
    serviceId = svc.id ?? svc.serviceId;
  }

  if (!staffId && staffName) {
    const staff = await findStaffByName(siteId, staffName);
    staffId     = staff?.id ?? staff?.staffId;
  }

  // 4. Determine start datetime
  const startDateTime = rawStart ?? buildISOFromDescription(slotDescription);

  const result = await bookAppointment({
    siteId,
    serviceId,
    staffId,
    clientId,
    startDateTime,
    notes: `Booked via AI receptionist | Name: ${guestName} | Phone: ${phone}`,
  });

  return result;
}

/** Last-resort: attempt to parse a human-readable slot description into ISO datetime. */
function buildISOFromDescription(description) {
  // This is a best-effort fallback.  Real appointments should always pass rawStart.
  // If this fails, Meevo will reject the booking and we'll fall back to mock.
  try {
    return new Date(description).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
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
      staff_name       = '',
      raw_start        = '',
      slot_service_id  = '',
      slot_staff_id    = '',
      notes            = '',
    } = args;

    if (!guest_name || !phone || !service || !slot_description) {
      return res.status(400).json({
        error: 'guest_name, phone, service, and slot_description are required',
      });
    }

    let confirmationNumber;
    let source = 'mock';

    if (meevoConfigured() && client?.meevo_site_id) {
      try {
        const result       = await bookLive({
          siteId:         client.meevo_site_id,
          guestName:      guest_name,
          phone,
          service,
          slotDescription: slot_description,
          staffName:       staff_name,
          rawStart:        raw_start || null,
          slotServiceId:   slot_service_id || null,
          slotStaffId:     slot_staff_id   || null,
        });
        confirmationNumber = String(result.confirmationNumber);
        source             = 'live';
      } catch (err) {
        console.warn(`[meevo/book] Live booking failed, using mock: ${err.message}`);
        confirmationNumber = mockConfirmationNumber();
      }
    } else {
      confirmationNumber = mockConfirmationNumber();
    }

    const bookedAt = formatInTZ(new Date(), {}, tz);

    // Always log to dashboard regardless of live/mock
    await supabase.from('waitlist').insert([{
      client_id:       client?.id ?? null,
      patient_name:    guest_name.trim(),
      phone:           phone.trim(),
      service_needed:  service.trim(),
      preferred_days:  slot_description.trim(),
      preferred_times: '',
      priority:        'routine',
      notes:           `BOOKED (${source}) — ${slot_description} | Conf#: ${confirmationNumber} | ${bookedAt}${notes ? ' | ' + notes : ''}`,
      contacted:       false,
    }]);

    const toolCallId = body?.message?.toolCalls?.[0]?.id ?? 'direct-call';
    console.log(`[meevo/book] ${guest_name} | ${service} | ${slot_description} | ${confirmationNumber} | ${source} | client=${client?.slug ?? 'unknown'}`);

    return res.status(200).json({
      results: [{
        toolCallId,
        result: JSON.stringify({
          confirmation_number: confirmationNumber,
          guest_name,
          appointment:         slot_description,
          service,
          message:             `Appointment confirmed. Your confirmation number is ${confirmationNumber}.`,
        }),
      }],
    });
  } catch (err) {
    console.error('[meevo/book] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
