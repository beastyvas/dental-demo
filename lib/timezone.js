/**
 * All date/time logic for the Hammond Dental backend.
 * Las Vegas = America/Los_Angeles (Pacific Time, observes DST).
 * Bug fix: was defaulting to UTC and treating year as 2024.
 */

export const TIMEZONE = process.env.TIMEZONE || 'America/Los_Angeles';

/** Returns a Date representing right now in wall-clock Pacific time. */
export function nowInLasVegas() {
  return new Date(
    new Date().toLocaleString('en-US', { timeZone: TIMEZONE })
  );
}

/**
 * Formats a Date (or ISO string) into a human-readable string in Pacific time.
 * e.g. "Saturday, May 17, 2026 at 11:34 PM"
 */
export function formatLasVegas(date = new Date(), opts = {}) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    timeZone: TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...opts,
  });
}

/**
 * Returns { hour, minute, dayOfWeek } all in Las Vegas local time.
 * dayOfWeek: 0 = Sunday … 6 = Saturday
 */
export function getLasVegasTime() {
  const now = nowInLasVegas();
  return {
    hour: now.getHours(),
    minute: now.getMinutes(),
    dayOfWeek: now.getDay(),
    fullDate: now,
  };
}
