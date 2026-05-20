/**
 * Business-hours logic — multi-tenant aware.
 * Pass a timezone string (IANA) to support clients in different time zones.
 * Defaults to America/Los_Angeles when no timezone is provided.
 *
 * Office hours: Monday–Friday 8:00 AM – 5:00 PM in the client's local time.
 * Closed: Saturday, Sunday, and major US holidays.
 */

import { getTimeInTZ, formatInTZ, TIMEZONE } from './timezone.js';

// ─── Holiday detection ────────────────────────────────────────────────────────

/** Nth weekday of a given month/year. week=1 is first, week=-1 is last. */
function nthWeekday(year, month, dayOfWeek, week) {
  if (week > 0) {
    const first = new Date(year, month - 1, 1);
    const diff  = (dayOfWeek - first.getDay() + 7) % 7;
    return new Date(year, month - 1, 1 + diff + (week - 1) * 7);
  }
  const last = new Date(year, month, 0);
  const diff  = (last.getDay() - dayOfWeek + 7) % 7;
  return new Date(year, month - 1, last.getDate() - diff);
}

/**
 * Returns true if the given Date falls on a major US holiday.
 * Uses the client's local date (not UTC) for comparison.
 */
export function isHoliday(date, timezone = TIMEZONE) {
  const lvStr = date.toLocaleString('en-US', { timeZone: timezone });
  const lv    = new Date(lvStr);
  const y     = lv.getFullYear();
  const m     = lv.getMonth() + 1;
  const d     = lv.getDate();

  const holidays = [
    { month: 1,  day: 1  },  // New Year's Day
    { month: 7,  day: 4  },  // Independence Day
    { month: 12, day: 25 },  // Christmas Day
    { month: 12, day: 26 },  // Day after Christmas (observed)
    (() => { const dt = nthWeekday(y, 1, 1, 3);  return { month: dt.getMonth()+1, day: dt.getDate() }; })(),  // MLK Day
    (() => { const dt = nthWeekday(y, 2, 1, 3);  return { month: dt.getMonth()+1, day: dt.getDate() }; })(),  // Presidents' Day
    (() => { const dt = nthWeekday(y, 5, 1, -1); return { month: dt.getMonth()+1, day: dt.getDate() }; })(),  // Memorial Day
    (() => { const dt = nthWeekday(y, 9, 1, 1);  return { month: dt.getMonth()+1, day: dt.getDate() }; })(),  // Labor Day
    (() => { const dt = nthWeekday(y, 11, 4, 4); return { month: dt.getMonth()+1, day: dt.getDate() }; })(),  // Thanksgiving
    (() => { const dt = nthWeekday(y, 11, 4, 4); const day = new Date(dt); day.setDate(day.getDate()+1); return { month: day.getMonth()+1, day: day.getDate() }; })(), // Black Friday
  ];

  return holidays.some(h => h.month === m && h.day === d);
}

// ─── Office status ─────────────────────────────────────────────────────────────

/**
 * Returns the current office status based on the client's local time.
 * @param {string} [timezone] — IANA timezone string, defaults to TIMEZONE env var
 * @returns {{ isOpen: boolean, status: string, reason: string, currentTime: string, nextOpen: string|null }}
 */
export function getOfficeStatus(timezone = TIMEZONE) {
  const now  = new Date();
  const { hour, dayOfWeek } = getTimeInTZ(timezone);
  const currentTimeStr = formatInTZ(now, { weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true }, timezone);

  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const inHours   = hour >= 8 && hour < 17;

  if (isHoliday(now, timezone)) {
    return {
      isOpen:      false,
      status:      'holiday',
      reason:      'The office is closed today for a holiday.',
      currentTime: currentTimeStr,
      nextOpen:    'Please call back on the next business day.',
    };
  }

  if (isWeekday && inHours) {
    return {
      isOpen:      true,
      status:      'open',
      reason:      'Office is open.',
      currentTime: currentTimeStr,
      nextOpen:    null,
    };
  }

  let nextOpen = 'Monday at 8:00 AM';
  if      (dayOfWeek === 0)              nextOpen = 'tomorrow (Monday) at 8:00 AM';
  else if (dayOfWeek === 6)              nextOpen = 'Monday at 8:00 AM';
  else if (!inHours && isWeekday) nextOpen = hour < 8 ? 'today at 8:00 AM' : 'tomorrow at 8:00 AM';

  return {
    isOpen:      false,
    status:      'after_hours',
    reason:      'The office is currently closed.',
    currentTime: currentTimeStr,
    nextOpen:    `We re-open ${nextOpen} local time.`,
  };
}
