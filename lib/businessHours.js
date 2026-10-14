/**
 * Business-hours logic — multi-tenant aware.
 * Pass a timezone string (IANA) to support clients in different time zones.
 * Defaults to America/Los_Angeles when no timezone is provided.
 *
 * Office hours come from clients.business_hours ({"mon":["07:00","17:00"],
 * ..., "sun": null}); with none set it's Monday–Friday 8:00 AM – 5:00 PM.
 * Closed on major US holidays either way.
 */

import { formatInTZ, TIMEZONE } from './timezone.js';

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

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Default when a client has no business_hours set: Mon–Fri 8:00–17:00.
export const DEFAULT_HOURS = {
  sun: null, mon: ['08:00', '17:00'], tue: ['08:00', '17:00'], wed: ['08:00', '17:00'],
  thu: ['08:00', '17:00'], fri: ['08:00', '17:00'], sat: null,
};

const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
const fmt12 = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${ap}`;
};

/** Wall-clock { dayOfWeek, minutes } for a Date in a timezone. */
function localParts(date, timezone) {
  const lv = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  return { dayOfWeek: lv.getDay(), minutes: lv.getHours() * 60 + lv.getMinutes() };
}

/** Is the business open at `date`? `hours` is clients.business_hours (or null for the default). */
export function isOpenAt(date = new Date(), timezone = TIMEZONE, hours = null) {
  if (isHoliday(date, timezone)) return false;
  const h = hours ?? DEFAULT_HOURS;
  const { dayOfWeek, minutes } = localParts(date, timezone);
  const span = h[DAY_KEYS[dayOfWeek]];
  return Boolean(span) && minutes >= toMin(span[0]) && minutes < toMin(span[1]);
}

/** One line a receptionist can read out: "Mon–Fri 7:00 AM–5:00 PM, Sat 8:00 AM–12:00 PM". */
export function describeHours(hours = null) {
  const h = hours ?? DEFAULT_HOURS;
  const names = { sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat' };
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const groups = [];
  for (const d of order) {
    const span = h[d] ? `${fmt12(h[d][0])}–${fmt12(h[d][1])}` : null;
    const last = groups[groups.length - 1];
    if (last && last.span === span) last.days.push(d);
    else groups.push({ days: [d], span });
  }
  return groups.filter((g) => g.span)
    .map((g) => `${names[g.days[0]]}${g.days.length > 1 ? `–${names[g.days[g.days.length - 1]]}` : ''} ${g.span}`)
    .join(', ') || 'by appointment';
}

/**
 * Returns the current office status based on the client's local time.
 * @param {string} [timezone] — IANA timezone string, defaults to TIMEZONE env var
 * @param {object|null} [hours] — clients.business_hours; null = Mon–Fri 8–5
 * @returns {{ isOpen: boolean, status: string, reason: string, currentTime: string, nextOpen: string|null, hours: string }}
 */
export function getOfficeStatus(timezone = TIMEZONE, hours = null) {
  const now = new Date();
  const h   = hours ?? DEFAULT_HOURS;
  const currentTimeStr = formatInTZ(now, { weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true }, timezone);
  const hoursLine = describeHours(h);

  if (isHoliday(now, timezone)) {
    return {
      isOpen: false, status: 'holiday', reason: 'The office is closed today for a holiday.',
      currentTime: currentTimeStr, nextOpen: 'Please call back on the next business day.', hours: hoursLine,
    };
  }

  if (isOpenAt(now, timezone, h)) {
    return { isOpen: true, status: 'open', reason: 'Office is open.', currentTime: currentTimeStr, nextOpen: null, hours: hoursLine };
  }

  // Next opening: later today, else the next day with hours.
  const { dayOfWeek, minutes } = localParts(now, timezone);
  const longNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let nextOpen = 'on the next business day';
  for (let i = 0; i < 8; i++) {
    const d = (dayOfWeek + i) % 7;
    const span = h[DAY_KEYS[d]];
    if (!span) continue;
    if (i === 0 && minutes >= toMin(span[0])) continue;
    nextOpen = `${i === 0 ? 'today' : i === 1 ? 'tomorrow' : longNames[d]} at ${fmt12(span[0])}`;
    break;
  }

  return {
    isOpen: false, status: 'after_hours', reason: 'The office is currently closed.',
    currentTime: currentTimeStr, nextOpen: `We re-open ${nextOpen} local time.`, hours: hoursLine,
  };
}
