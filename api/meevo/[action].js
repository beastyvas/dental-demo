/**
 * POST /api/meevo/availability | /api/meevo/book | /api/meevo/new-member
 * Mock Meevo integration for Massage Envy — consolidated into one dynamic
 * route ([action].js) so it counts as a single serverless function instead
 * of three. Vercel's Hobby plan caps a deployment at 12 functions, and
 * three separate files pushed this project over that limit.
 *
 * URLs are unchanged from when these were separate files, so the Vapi tool
 * configs (meevo-availability-tool.json, meevo-book-tool.json,
 * meevo-new-member-tool.json) still point at the right place.
 */

import { supabase }            from '../../lib/supabase.js';
import { sendSMS }             from '../../lib/sms.js';
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
  if (action === 'new-member')   return handleNewMember(req, res);
  return res.status(404).json({ error: `Unknown meevo action: ${action}` });
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

// ─── checkAvailability ────────────────────────────────────────────────────

const THERAPISTS = ['Elizabeth', 'Alex', 'Bree', 'Jasmine', 'Kenneth', 'Precious'];

const TIMES = {
  morning:   ['9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM'],
  afternoon: ['12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM', '4:00 PM'],
  evening:   ['4:30 PM', '5:00 PM', '5:30 PM', '6:00 PM', '6:30 PM', '7:00 PM'],
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

function buildSlots(datePref = '', therapistPref = '', tz = TIMEZONE) {
  const now  = nowInTZ(tz);
  const pref = datePref.toLowerCase();
  const seed = now.getDate(); // stable within the day

  let timePool;
  if (pref.includes('morning'))                                      timePool = TIMES.morning;
  else if (pref.includes('evening') || pref.includes('after 5'))    timePool = TIMES.evening;
  else if (pref.includes('afternoon') || pref.includes('after noon')) timePool = TIMES.afternoon;
  else                                                               timePool = [...TIMES.morning, ...TIMES.afternoon];

  const wantWeekend = pref.includes('weekend') || pref.includes('sat') || pref.includes('sun');
  const wantWeekday = !wantWeekend && (
    pref.includes('weekday') || pref.includes('mon') || pref.includes('tue') ||
    pref.includes('wed') || pref.includes('thu') || pref.includes('fri')
  );

  const slots = [];
  let offset = 1;

  while (slots.length < 3 && offset <= 14) {
    const day = addDays(now, offset);
    const dow = day.getDay();
    const isWeekend = dow === 0 || dow === 6;

    const dayOk = wantWeekend ? isWeekend : wantWeekday ? !isWeekend : true;

    if (dayOk) {
      const i         = slots.length;
      const time      = pick(timePool, seed + i * 7);
      const therapist = therapistPref || pick(THERAPISTS, seed + i * 3);

      slots.push({
        slot_id:   `slot-${i + 1}`,
        date:      fmtDate(day),
        time,
        therapist,
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

    const { service = '', date_preference = '', therapist_preference = '' } = extractArgs(body);

    const slots = buildSlots(date_preference, therapist_preference, tz);

    console.log(`[meevo/availability] ${client?.slug ?? 'unknown'} — ${service} — ${slots.length} slots returned`);

    const lines  = slots.map((s, i) => `${i + 1}. ${s.date} at ${s.time} with ${s.therapist}`).join('\n');
    const result = `Here are 3 available slots:\n${lines}\n\nRead all 3 options to the caller now and ask which one works.`;

    return res.status(200).json({
      results: [{ toolCallId: toolCallId(body), result }],
    });
  } catch (err) {
    console.error('[meevo/availability] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── bookAppointment ───────────────────────────────────────────────────────

function confirmationNumber() {
  return 'ME-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

async function handleBook(req, res) {
  try {
    const body        = req.body;
    const assistantId = body?.message?.call?.assistantId;
    const client      = await getClientByAgentId(assistantId);
    const tz          = client?.timezone ?? TIMEZONE;

    const {
      guest_name,
      phone,
      service,
      slot_description,
      notes = '',
    } = extractArgs(body);

    if (!guest_name || !phone || !service || !slot_description) {
      return res.status(400).json({
        error: 'guest_name, phone, service, and slot_description are required',
      });
    }

    const confNum  = confirmationNumber();
    const bookedAt = formatInTZ(new Date(), {}, tz);

    const { error } = await supabase.from('waitlist').insert([{
      client_id:       client?.id ?? null,
      patient_name:    guest_name.trim(),
      phone:           phone.trim(),
      service_needed:  service.trim(),
      preferred_days:  slot_description.trim(),
      preferred_times: '',
      priority:        'routine',
      notes:           `BOOKED — ${slot_description} | Conf#: ${confNum} | ${bookedAt}${notes ? ' | ' + notes : ''}`,
      contacted:       false,
    }]);

    if (error) {
      console.error('[meevo/book] Supabase insert error:', error);
      return res.status(500).json({ error: 'Failed to save booking' });
    }

    console.log(`[meevo/book] Booked: ${guest_name} | ${service} | ${slot_description} | ${confNum} | client=${client?.slug ?? 'unknown'}`);

    return res.status(200).json({
      results: [{
        toolCallId: toolCallId(body),
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

// ─── logNewMemberInquiry ───────────────────────────────────────────────────

async function handleNewMember(req, res) {
  try {
    const body        = req.body;
    const assistantId = body?.message?.call?.assistantId;
    const client      = await getClientByAgentId(assistantId);
    const tz          = client?.timezone ?? TIMEZONE;

    const {
      guest_name,
      phone,
      service_interest = '',
      reason = 'new_member',
      notes = '',
    } = extractArgs(body);

    if (!guest_name || !phone) {
      return res.status(400).json({ error: 'guest_name and phone are required' });
    }

    const now = formatInTZ(new Date(), {}, tz);

    const reasonLabel = {
      new_member:    'NEW MEMBER — needs account + card on file',
      after_hours:   'AFTER HOURS booking request',
      card_required: 'CARD ON FILE missing — needs front desk',
    }[reason] ?? reason;

    const fullNotes = `${reasonLabel} | Called: ${now}${service_interest ? ` | Wants: ${service_interest}` : ''}${notes ? ` | ${notes}` : ''}`;

    await supabase.from('waitlist').insert([{
      client_id:       client?.id ?? null,
      patient_name:    guest_name.trim(),
      phone:           phone.trim(),
      service_needed:  service_interest.trim() || 'To be confirmed',
      preferred_days:  '',
      preferred_times: '',
      priority:        'routine',
      notes:           fullNotes,
      contacted:       false,
    }]);

    const frontDeskPhone = client?.front_desk_phone;
    if (frontDeskPhone) {
      const smsReasons = {
        new_member:    '🔔 New member inquiry',
        after_hours:   '🌙 After-hours booking request',
        card_required: '💳 Card on file needed',
      };
      const smsLabel = smsReasons[reason] ?? '📋 Callback needed';

      await sendSMS(
        frontDeskPhone,
        `${smsLabel} via virtual receptionist:\n` +
        `Name: ${guest_name}\n` +
        `Phone: ${phone}\n` +
        (service_interest ? `Wants: ${service_interest}\n` : '') +
        `Called at: ${now}\n` +
        `→ Follow up ASAP to ${reason === 'new_member' ? 'create account + book' : 'confirm appointment'}.`
      );
    }

    console.log(`[meevo/new-member] ${reason} — ${guest_name} (${phone}) | client=${client?.slug ?? 'unknown'}`);

    const responses = {
      new_member:
        `Got it. I've passed your info to our team — someone will call you to get your account set up and lock in your appointment. Anything else I can help with?`,
      after_hours:
        `We're closed right now but I've logged your request. Our team will reach out first thing in the morning to get you booked. Is there anything else?`,
      card_required:
        `No problem — I've flagged your info for our front desk and they'll reach out shortly to get that sorted and get you booked. Is there anything else?`,
    };

    return res.status(200).json({
      results: [{
        toolCallId: toolCallId(body),
        result: responses[reason] ?? responses.new_member,
      }],
    });
  } catch (err) {
    console.error('[meevo/new-member] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
