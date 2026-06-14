/**
 * POST /api/calendar/book
 * Vapi tool: `bookAppointment`
 *
 * Books a service appointment:
 *   1. Best-effort: creates a Google Calendar event on the client's calendar.
 *   2. Always: logs the booking to the waitlist table so it appears on the
 *      client's dashboard.
 *
 * Calendar sync failures (missing credentials, bad calendar_id, API errors)
 * are logged but never block the dashboard booking or the response to Vapi.
 */

import { supabase }             from '../../lib/supabase.js';
import { verifyVapiRequest }    from '../../lib/vapi.js';
import { getClientByAgentId }   from '../../lib/clients.js';
import { TIMEZONE }             from '../../lib/timezone.js';
import { createCalendarEvent }  from '../../lib/googleCalendar.js';

function confirmationNumber() {
  return 'BK-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Parses "2:00 PM", "14:00", "2pm", "2 pm", "noon", "midnight" -> { hour, minute } (24h). Returns null if invalid.
function parseTime(input) {
  const s = String(input).trim().toLowerCase();
  if (s === 'noon')     return { hour: 12, minute: 0 };
  if (s === 'midnight') return { hour: 0,  minute: 0 };

  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;

  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3];
  if (hour > 23 || minute > 59) return null;

  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  return { hour, minute };
}

// Adds minutes to a YYYY-MM-DD + hour/minute, rolling over to the next day
// if needed. Pure calendar arithmetic — never touches timezones.
function addMinutes(dateStr, hour, minute, durationMinutes) {
  let total = hour * 60 + minute + durationMinutes;
  const dayOffset = Math.floor(total / 1440);
  total = ((total % 1440) + 1440) % 1440;

  let date = dateStr;
  if (dayOffset !== 0) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dayOffset);
    date = d.toISOString().slice(0, 10);
  }

  return { date, hour: Math.floor(total / 60), minute: total % 60 };
}

// "2026-06-16" -> "Tuesday, June 16" (pinned to UTC so the calendar date never shifts)
function formatDateLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
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
      customer_name,
      phone,
      service,
      address          = '',
      appointment_date,
      appointment_time,
      duration_minutes,
      notes            = '',
    } = args;

    if (!customer_name || !phone || !service || !appointment_date || !appointment_time) {
      return res.status(400).json({
        error: 'customer_name, phone, service, appointment_date, and appointment_time are required',
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(appointment_date)) {
      return res.status(400).json({ error: 'appointment_date must be in YYYY-MM-DD format' });
    }

    const start = parseTime(appointment_time);
    if (!start) {
      return res.status(400).json({ error: 'appointment_time could not be parsed' });
    }

    const duration = Number(duration_minutes) > 0 ? Number(duration_minutes) : 60;
    const end       = addMinutes(appointment_date, start.hour, start.minute, duration);
    const startISO  = `${appointment_date}T${pad(start.hour)}:${pad(start.minute)}:00`;
    const endISO    = `${end.date}T${pad(end.hour)}:${pad(end.minute)}:00`;
    const label     = `${formatDateLabel(appointment_date)} at ${appointment_time}`;
    const confNum   = confirmationNumber();

    // 1. Best-effort: sync to Google Calendar. Never blocks the booking.
    const cal = await createCalendarEvent({
      calendarId:  client?.calendar_id,
      summary:     `${service} — ${customer_name}`,
      description: [
        `Phone: ${phone}`,
        `Confirmation: ${confNum}`,
        notes && `Notes: ${notes}`,
      ].filter(Boolean).join('\n'),
      location: address || undefined,
      start: startISO,
      end:   endISO,
      timezone: tz,
    });

    if (!cal.ok) {
      console.error(`[calendar/book] Calendar sync failed for ${client?.slug ?? 'unknown'}: ${cal.error}`);
    }

    // 2. Always: log to the dashboard waitlist table.
    const { error } = await supabase.from('waitlist').insert([{
      client_id:       client?.id ?? null,
      patient_name:    customer_name.trim(),
      phone:           phone.trim(),
      service_needed:  service.trim(),
      preferred_days:  label,
      preferred_times: '',
      priority:        'routine',
      notes: [
        `BOOKED — ${label}`,
        address && `Address: ${address}`,
        `Conf#: ${confNum}`,
        cal.ok ? 'Synced to Google Calendar' : 'Calendar sync failed — booked in dashboard only',
        notes,
      ].filter(Boolean).join(' | '),
      contacted: false,
    }]);

    if (error) {
      console.error('[calendar/book] Supabase insert error:', error);
      return res.status(500).json({ error: 'Failed to save booking' });
    }

    const toolCallId = body?.message?.toolCalls?.[0]?.id ?? 'direct-call';

    console.log(`[calendar/book] Booked: ${customer_name} | ${service} | ${label} | ${confNum} | client=${client?.slug ?? 'unknown'} | calendar=${cal.ok ? 'ok' : 'failed'}`);

    return res.status(200).json({
      results: [{
        toolCallId,
        result: JSON.stringify({
          confirmation_number: confNum,
          customer_name,
          appointment: label,
          service,
          message: `Appointment confirmed for ${label}. Confirmation number: ${confNum}.`,
        }),
      }],
    });
  } catch (err) {
    console.error('[calendar/book] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
