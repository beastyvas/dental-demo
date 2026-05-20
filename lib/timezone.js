/**
 * Date/time helpers — multi-tenant aware.
 * All functions accept an optional timezone string (IANA, e.g. 'America/Los_Angeles').
 * Defaults to the TIMEZONE env var or 'America/Los_Angeles' if unset.
 */

export const TIMEZONE = process.env.TIMEZONE || 'America/Los_Angeles';

/** Returns a Date representing right now in the given timezone's wall-clock time. */
export function nowInTZ(tz = TIMEZONE) {
  return new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
}

/**
 * Formats a Date (or ISO string) into a human-readable string in the given timezone.
 * e.g. "Saturday, May 17, 2026 at 11:34 PM"
 */
export function formatInTZ(date = new Date(), opts = {}, tz = TIMEZONE) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    timeZone: tz,
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
 * Returns { hour, minute, dayOfWeek } in the given timezone's local time.
 * dayOfWeek: 0 = Sunday … 6 = Saturday
 */
export function getTimeInTZ(tz = TIMEZONE) {
  const now = nowInTZ(tz);
  return {
    hour:      now.getHours(),
    minute:    now.getMinutes(),
    dayOfWeek: now.getDay(),
    fullDate:  now,
  };
}

// Backward-compat aliases (used by cron, emergency, and external code)
export const nowInLasVegas   = ()           => nowInTZ();
export const formatLasVegas  = (date, opts) => formatInTZ(date, opts);
export const getLasVegasTime = ()           => getTimeInTZ();
