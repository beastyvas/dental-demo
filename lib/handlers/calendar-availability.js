/**
 * POST /api/tools/calendar-availability
 * Vapi tool: `checkAvailability` — open appointment times for a date.
 *
 * Reads the client's Google Calendar (FreeBusy) and business hours. With no
 * calendar connected it returns every slot in business hours, so the agent
 * can still offer times and the owner confirms them.
 */

import { verifyVapiRequest }  from '../vapi.js';
import { getClientByAgentId } from '../clients.js';
import { TIMEZONE }           from '../timezone.js';
import { getBusy }            from '../googleCalendar.js';
import { DEFAULT_HOURS }      from '../businessHours.js';
import { openSlots, zonedToUtcMs } from '../slots.js';

const formatDateLabel = (dateStr) =>
  new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyVapiRequest(req, res)) return;

  const body       = req.body;
  const toolCallId = body?.message?.toolCalls?.[0]?.id ?? 'direct-call';
  const args       = body?.message?.toolCalls?.[0]?.function?.arguments ?? body ?? {};
  const reply      = (obj) => res.status(200).json({ results: [{ toolCallId, result: JSON.stringify(obj) }] });

  try {
    const client = await getClientByAgentId(body?.message?.call?.assistantId);
    const tz     = client?.timezone ?? TIMEZONE;
    const hours  = client?.business_hours ?? DEFAULT_HOURS;
    const { date, duration_minutes } = args;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
      return reply({ error: 'date must be YYYY-MM-DD' });
    }
    const duration = Number(duration_minutes) > 0 ? Number(duration_minutes) : 60;

    let busy = [];
    let calendarChecked = false;
    if (client?.calendar_id) {
      const dayStart = zonedToUtcMs(date, 0, 0, tz);
      const fb = await getBusy({ calendarId: client.calendar_id, fromMs: dayStart, toMs: dayStart + 24 * 3600_000 });
      if (fb.ok) { busy = fb.busy; calendarChecked = true; }
      else console.warn(`[calendar-availability] FreeBusy failed for ${client.slug}: ${fb.error}`);
    }

    const slots = openSlots({ dateStr: date, hours, busy, tz, durationMinutes: duration }).map((s) => s.label);
    return reply({
      date: formatDateLabel(date),
      open_times: slots,
      calendar_checked: calendarChecked,
      message: slots.length
        ? `Open times on ${formatDateLabel(date)}: ${slots.join(', ')}.`
        : `Nothing open on ${formatDateLabel(date)}. Ask about another day.`,
    });
  } catch (err) {
    console.error('[calendar-availability] error:', err);
    return reply({ error: 'Could not check availability — take their preferred time and say the office will confirm.' });
  }
}
