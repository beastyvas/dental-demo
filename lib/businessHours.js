/**
 * Business-hours logic for Hammond Dental.
 * Las Vegas = America/Los_Angeles (Pacific Time).
 * All times are checked against LV local time, NOT UTC.
 *
 * Office hours: Monday–Friday 8:00 AM – 5:00 PM
 * Closed: Saturday, Sunday, and major US holidays.
 */

import { getLasVegasTime, formatLasVegas } from './timezone.js';

// ─── Holiday detection ────────────────────────────────────────────────────────

/** Nth weekday of a given month/year. week=1 is first, week=-1 is last. */
function nthWeekday(year, month, dayOfWeek, week) {
  if (week > 0) {
    const first = new Date(year, month - 1, 1);
    const diff  = (dayOfWeek - first.getDay() + 7) % 7;
    return new Date(year, month - 1, 1 + diff + (week - 1) * 7);
  } else {
    // Last occurrence: count from end of month
    const last = new Date(year, month, 0); // last day of month
    const diff = (last.getDay() - dayOfWeek + 7) % 7;
    return new Date(year, month - 1, last.getDate() - diff);
  }
}

/**
 * Returns true if the given Date falls on a major US holiday.
 * Uses the Las Vegas local date (not UTC) for comparison.
 */
export function isHoliday(date) {
  const lvStr  = date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  const lv     = new Date(lvStr);
  const y      = lv.getFullYear();
  const m      = lv.getMonth() + 1; // 1-based
  const d      = lv.getDate();

  const holidays = [
    // Fixed holidays
    { month: 1,  day: 1  },  // New Year's Day
    { month: 7,  day: 4  },  // Independence Day
    { month: 12, day: 25 },  // Christmas Day
    { month: 12, day: 26 },  // Day after Christmas (observed)

    // Floating holidays
    (() => { const dt = nthWeekday(y, 1, 1, 3); return { month: dt.getMonth()+1, day: dt.getDate() }; })(), // MLK Day
    (() => { const dt = nthWeekday(y, 2, 1, 3); return { month: dt.getMonth()+1, day: dt.getDate() }; })(), // Presidents' Day
    (() => { const dt = nthWeekday(y, 5, 1, -1); return { month: dt.getMonth()+1, day: dt.getDate() }; })(), // Memorial Day
    (() => { const dt = nthWeekday(y, 9, 1, 1); return { month: dt.getMonth()+1, day: dt.getDate() }; })(), // Labor Day
    (() => { const dt = nthWeekday(y, 11, 4, 4); return { month: dt.getMonth()+1, day: dt.getDate() }; })(), // Thanksgiving
    (() => { const dt = nthWeekday(y, 11, 4, 4); const day = new Date(dt); day.setDate(day.getDate()+1); return { month: day.getMonth()+1, day: day.getDate() }; })(), // Black Friday (day after Thanksgiving)
  ];

  return holidays.some(h => h.month === m && h.day === d);
}

// ─── Office status ─────────────────────────────────────────────────────────

/**
 * Returns the current office status based on Las Vegas time.
 * @returns {{
 *   isOpen: boolean,
 *   status: 'open' | 'after_hours' | 'holiday',
 *   reason: string,
 *   currentTime: string,
 *   nextOpen: string
 * }}
 */
export function getOfficeStatus() {
  const now = new Date();
  const { hour, dayOfWeek, fullDate } = getLasVegasTime();
  const currentTimeStr = formatLasVegas(now, { weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true });

  // 0=Sun, 1=Mon, …, 5=Fri, 6=Sat
  const isWeekday  = dayOfWeek >= 1 && dayOfWeek <= 5;
  const inHours    = hour >= 8 && hour < 17; // 8:00 AM – 4:59 PM

  if (isHoliday(now)) {
    return {
      isOpen: false,
      status: 'holiday',
      reason: 'The office is closed today for a holiday.',
      currentTime: currentTimeStr,
      nextOpen: 'Please call back on the next business day.',
    };
  }

  if (isWeekday && inHours) {
    return {
      isOpen: true,
      status: 'open',
      reason: 'Office is open.',
      currentTime: currentTimeStr,
      nextOpen: null,
    };
  }

  // Closed — compute next open time
  let nextOpen = 'Monday at 8:00 AM';
  if (dayOfWeek === 0) nextOpen = 'tomorrow (Monday) at 8:00 AM';
  else if (dayOfWeek === 6) nextOpen = 'Monday at 8:00 AM';
  else if (!inHours && isWeekday) {
    nextOpen = hour < 8
      ? 'today at 8:00 AM'
      : 'tomorrow at 8:00 AM';
  }

  return {
    isOpen: false,
    status: 'after_hours',
    reason: 'The office is currently closed.',
    currentTime: currentTimeStr,
    nextOpen: `We re-open ${nextOpen} Las Vegas time.`,
  };
}
