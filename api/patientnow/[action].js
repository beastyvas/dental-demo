/**
 * POST /api/patientnow/availability | /api/patientnow/book
 * Mock PatientNow Essentials integration for Beverly Hills Rejuvenation
 * Center (Henderson) — consolidated into one dynamic route ([action].js)
 * so it counts as a single serverless function. Vercel's Hobby plan caps
 * a deployment at 12 functions.
 *
 * This is a MOCK. BHRC's real booking system of record is PatientNow
 * Essentials, which has its own API, but it requires BHRC to request API
 * credentials directly from PatientNow as a partner/integration. Until we
 * have those credentials + their API docs, this returns realistic-looking
 * slots and logs bookings to the dashboard waitlist table exactly like the
 * real thing will, so Arianna's booking flow can be built and tested now.
 *
 * TO GO LIVE: once BHRC hands off PatientNow API credentials, replace the
 * mock logic inside handleAvailability/handleBook with real calls to
 * PatientNow's appointment endpoints. The request/response shape Vapi
 * expects (toolCallId + result) should stay the same — only the inside of
 * each handler needs to change.
 */

import { supabase }            from '../../lib/supabase.js';
import { verifyVapiRequest }   from '../../lib/vapi.js';
import { getClientByAgentId }  from '../../lib/clients.js';
import { nowInTZ, formatInTZ, TIMEZONE } from '../../lib/timezone.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyVapiRequest(req, res)) return;

  const { action } = req.query;
  if (action === 'availability') return handleAvailability(req, res);
  if (action === 'book')         return handleBook(req, res);
  return res.status(404).json({ error: `Unknown patientnow action: ${action}` });
}

function extractArgs(body) {
  if (body?.message?.toolCalls?.[0]?.function?.arguments) {
    return body.message.toolCalls[0].function.arguments;
  }
  return body;
}

function toolCallId(body) {
  return body?.message?.toolCalls?.[0]?.id ?? 'direct-call';
}

// ─── checkAvailability (MOCK — replace with real PatientNow call) ─────────

const TIMES = {
  morning:   ['9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM'],
  afternoon: ['12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM', '4:00 PM'],
  evening:   ['4:30 PM', '5:00 PM'],
};

function pick(arr, seed) {
  return arr[Math.abs(seed) % arr.length];
}

function addDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function buildSlots(datePref = '', tz = TIMEZONE) {
  const now  = nowInTZ(tz);
  const pref = datePref.toLowerCase();
  const seed = now.getDate(); // stable within the day

  let timePool;
  if (pref.includes('morning'))                                       timePool = TIMES.morning;
  else if (pref.includes('evening') || pref.includes('after 5'))      timePool = TIMES.evening;
  else if (pref.includes('afternoon') || pref.includes('after noon')) timePool = TIMES.afternoon;
  else                                                                timePool = [...TIMES.morning, ...TIMES.afternoon];

  const wantWeekend = pref.includes('weekend') || pref.includes('sat') || pref.includes('sun');
  const wantWeekday = !wantWeekend && (
    pref.includes('weekday') || pref.includes('mon') || pref.includes('tue') ||
    pref.includes('wed') || pref.includes('thu') || pref.includes('fri')
  );

  const slots = [];
  let offset = 1;

  while (slots.length < 3 && offset <= 21) {
    const day = addDays(now, offset);
    const dow = day.getDay();
    const isWeekend = dow === 0 || dow === 6;

    const dayOk = wantWeekend ? isWeekend : wantWeekday ? !isWeekend : !isWeekend;

    if (dayOk) {
      const i    = slots.length;
      const time = pick(timePool, seed + i * 7);

      slots.push({
        slot_id: `slot-${i + 1}`,
        date:    fmtDate(day),
        time,
      });

      offset += 2;
    }

    offset++;
  }

  return slots;
}

async function handleAvailability(req, res) {
  try {
    const body        = req.body;
    const assistantId = body?.message?.call?.assistantId;
    const client      = await getClientByAgentId(assistantId);
    const tz          = client?.timezone ?? TIMEZONE;

    const { treatment = '', date_preference = '' } = extractArgs(body);

    const slots = buildSlots(date_preference, tz);

    console.log(`[patientnow/availability] ${client?.slug ?? 'unknown'} — ${treatment} — ${slots.length} slots returned`);

    const lines  = slots.map((s, i) => `${i + 1}. ${s.date} at ${s.time}`).join('\n');
    const result = `Here are 3 available slots:\n${lines}\n\nRead all 3 options to the caller now and ask which one works.`;

    return res.status(200).json({
      results: [{ toolCallId: toolCallId(body), result }],
    });
  } catch (err) {
    console.error('[patientnow/availability] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── bookAppointment (MOCK — replace with real PatientNow call) ──────────

function confirmationNumber() {
  return 'PN-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

async function handleBook(req, res) {
  try {
    const body        = req.body;
    const assistantId = body?.message?.call?.assistantId;
    const client      = await getClientByAgentId(assistantId);
    const tz          = client?.timezone ?? TIMEZONE;

    const {
      customer_name,
      phone,
      service,
      slot_description,
      notes = '',
    } = extractArgs(body);

    if (!customer_name || !phone || !service || !slot_description) {
      return res.status(400).json({
        error: 'customer_name, phone, service, and slot_description are required',
      });
    }

    const confNum  = confirmationNumber();
    const bookedAt = formatInTZ(new Date(), {}, tz);

    const { error } = await supabase.from('waitlist').insert([{
      client_id:       client?.id ?? null,
      patient_name:    customer_name.trim(),
      phone:           phone.trim(),
      service_needed:  service.trim(),
      preferred_days:  slot_description.trim(),
      preferred_times: '',
      priority:        'routine',
      notes:           `BOOKED — ${slot_description} | Conf#: ${confNum} | ${bookedAt}${notes ? ' | ' + notes : ''}`,
      contacted:       false,
    }]);

    if (error) {
      console.error('[patientnow/book] Supabase insert error:', error);
      return res.status(500).json({ error: 'Failed to save booking' });
    }

    console.log(`[patientnow/book] Booked: ${customer_name} | ${service} | ${slot_description} | ${confNum} | client=${client?.slug ?? 'unknown'}`);

    return res.status(200).json({
      results: [{
        toolCallId: toolCallId(body),
        result: JSON.stringify({
          confirmation_number: confNum,
          customer_name,
          appointment: slot_description,
          service,
          message: `Appointment confirmed for ${slot_description}. Confirmation number: ${confNum}.`,
        }),
      }],
    });
  } catch (err) {
    console.error('[patientnow/book] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
