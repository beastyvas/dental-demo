/**
 * POST /api/meevo/availability
 * Vapi tool: `checkAvailability`
 *
 * When MEEVO_* env vars + client.meevo_site_id are set, pulls live slots
 * from the Meevo Connect API.  Falls back to mock slots for demos.
 */

import { verifyVapiRequest }  from '../../lib/vapi.js';
import { getClientByAgentId } from '../../lib/clients.js';
import { nowInTZ, TIMEZONE }  from '../../lib/timezone.js';
import {
  meevoConfigured,
  findServiceByName,
  findStaffByName,
  getAvailability,
  buildDateRange,
} from '../../lib/meevo.js';

// ── Mock data (fallback) ──────────────────────────────────────────────────────

const MOCK_THERAPISTS = ['Elizabeth', 'Alex', 'Bree', 'Jasmine', 'Kenneth', 'Precious'];
const MOCK_TIMES = {
  morning:   ['9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM'],
  afternoon: ['12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM', '4:00 PM'],
  evening:   ['4:30 PM', '5:00 PM', '5:30 PM', '6:00 PM', '6:30 PM', '7:00 PM'],
};

function pick(arr, seed) { return arr[Math.abs(seed) % arr.length]; }
function addDays(base, n) { const d = new Date(base); d.setDate(d.getDate() + n); return d; }
function fmtDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function buildMockSlots(datePref = '', therapistPref = '', tz = TIMEZONE) {
  const now  = nowInTZ(tz);
  const pref = datePref.toLowerCase();
  const seed = now.getDate();

  let timePool;
  if (pref.includes('morning'))                                        timePool = MOCK_TIMES.morning;
  else if (pref.includes('evening') || pref.includes('after 5'))      timePool = MOCK_TIMES.evening;
  else if (pref.includes('afternoon') || pref.includes('after noon')) timePool = MOCK_TIMES.afternoon;
  else                                                                 timePool = [...MOCK_TIMES.morning, ...MOCK_TIMES.afternoon];

  const wantWeekend = pref.includes('weekend') || pref.includes('sat') || pref.includes('sun');
  const wantWeekday = !wantWeekend && (
    pref.includes('weekday') || pref.includes('mon') || pref.includes('tue') ||
    pref.includes('wed') || pref.includes('thu') || pref.includes('fri')
  );

  const slots = [];
  let offset  = 1;

  while (slots.length < 3 && offset <= 14) {
    const day     = addDays(now, offset);
    const dow     = day.getDay();
    const weekend = dow === 0 || dow === 6;
    const dayOk   = wantWeekend ? weekend : wantWeekday ? !weekend : true;

    if (dayOk) {
      const i         = slots.length;
      slots.push({
        slot_id:   `slot-${i + 1}`,
        date:      fmtDate(day),
        time:      pick(timePool, seed + i * 7),
        therapist: therapistPref || pick(MOCK_THERAPISTS, seed + i * 3),
      });
      offset += 2;
    }
    offset++;
  }

  return slots;
}

// ── Live Meevo availability ───────────────────────────────────────────────────

async function fetchLiveSlots({ siteId, service, datePref, therapistPref }) {
  const { startDate, endDate } = buildDateRange(datePref, 14);

  const [serviceRecord, staffRecord] = await Promise.all([
    findServiceByName(siteId, service),
    therapistPref ? findStaffByName(siteId, therapistPref) : Promise.resolve(null),
  ]);

  if (!serviceRecord) {
    throw new Error(`Service not found in Meevo: "${service}"`);
  }

  const slots = await getAvailability({
    siteId,
    serviceId: serviceRecord.id ?? serviceRecord.serviceId,
    startDate,
    endDate,
    staffId:   staffRecord?.id ?? staffRecord?.staffId,
  });

  // Return max 3 slots so the AI response stays concise
  return slots.slice(0, 3);
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

    const { service = '', date_preference = '', therapist_preference = '' } = args;

    let slots;
    let source = 'mock';

    if (meevoConfigured() && client?.meevo_site_id) {
      try {
        slots  = await fetchLiveSlots({
          siteId:        client.meevo_site_id,
          service,
          datePref:      date_preference,
          therapistPref: therapist_preference,
        });
        source = 'live';
      } catch (err) {
        console.warn(`[meevo/availability] Live API failed, falling back to mock: ${err.message}`);
        slots = buildMockSlots(date_preference, therapist_preference, tz);
      }
    } else {
      slots = buildMockSlots(date_preference, therapist_preference, tz);
    }

    const toolCallId = body?.message?.toolCalls?.[0]?.id ?? 'direct-call';
    console.log(`[meevo/availability] ${client?.slug ?? 'unknown'} — ${service} — ${slots.length} slots (${source})`);

    const lines  = slots.map((s, i) => `${i + 1}. ${s.date} at ${s.time} with ${s.therapist}`).join('\n');
    const result = `Here are ${slots.length} available slots:\n${lines}\n\nRead all options to the caller and ask which one works best.`;

    return res.status(200).json({ results: [{ toolCallId, result }] });
  } catch (err) {
    console.error('[meevo/availability] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
