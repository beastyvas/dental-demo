/**
 * POST /api/meevo/availability
 * Vapi tool: `checkAvailability`
 * Mock Meevo integration — returns 3 realistic open slots.
 * Slot generation is seeded from today's date so slots look stable
 * within a demo session but vary day to day.
 */

import { verifyVapiRequest }  from '../../lib/vapi.js';
import { getClientByAgentId } from '../../lib/clients.js';
import { nowInTZ, TIMEZONE }  from '../../lib/timezone.js';

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

  // Choose time pool based on preference
  let timePool;
  if (pref.includes('morning'))                                      timePool = TIMES.morning;
  else if (pref.includes('evening') || pref.includes('after 5'))    timePool = TIMES.evening;
  else if (pref.includes('afternoon') || pref.includes('after noon')) timePool = TIMES.afternoon;
  else                                                               timePool = [...TIMES.morning, ...TIMES.afternoon];

  // Prefer weekends / weekdays based on hint
  const wantWeekend = pref.includes('weekend') || pref.includes('sat') || pref.includes('sun');
  const wantWeekday = !wantWeekend && (
    pref.includes('weekday') || pref.includes('mon') || pref.includes('tue') ||
    pref.includes('wed') || pref.includes('thu') || pref.includes('fri')
  );

  const slots = [];
  let offset = 1;

  while (slots.length < 3 && offset <= 14) {
    const day = addDays(now, offset);
    const dow = day.getDay(); // 0=Sun … 6=Sat
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

      offset += 2; // leave a realistic gap between offered slots
    }

    offset++;
  }

  return slots;
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

    const { service = '', date_preference = '', therapist_preference = '' } = args;

    const slots = buildSlots(date_preference, therapist_preference, tz);

    const toolCallId = body?.message?.toolCalls?.[0]?.id ?? 'direct-call';

    console.log(`[meevo/availability] ${client?.slug ?? 'unknown'} — ${service} — ${slots.length} slots returned`);

    const lines = slots.map((s, i) => `${i + 1}. ${s.date} at ${s.time} with ${s.therapist}`).join('\n');
    const result = `Here are 3 available slots:\n${lines}\n\nRead all 3 options to the caller now and ask which one works.`;

    return res.status(200).json({
      results: [{ toolCallId, result }],
    });
  } catch (err) {
    console.error('[meevo/availability] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
