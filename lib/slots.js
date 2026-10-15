/**
 * Appointment slot math — pure, timezone-aware, no I/O.
 */

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Offset (ms) of `tz` from UTC at instant `utcMs`. */
function tzOffsetMs(utcMs, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - utcMs;
}

/** UTC epoch ms for wall-clock "YYYY-MM-DD hh:mm" in `tz`. */
export function zonedToUtcMs(dateStr, hour, minute, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  let ms = guess - tzOffsetMs(guess, tz);
  ms = guess - tzOffsetMs(ms, tz); // second pass handles DST edges
  return ms;
}

const overlaps = (aStart, aEnd, busy) => busy.some((b) => aStart < b.end && aEnd > b.start);

const label = (h, m) => `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;

/** Day-of-week key for a YYYY-MM-DD (calendar date, no tz shift). */
export const dayKey = (dateStr) => DAY_KEYS[new Date(`${dateStr}T12:00:00Z`).getUTCDay()];

/**
 * Open start times on `dateStr` inside business hours that don't collide with `busy`.
 * @param {object} p
 * @param {string} p.dateStr           YYYY-MM-DD
 * @param {object} p.hours             business_hours object (mon: ['08:00','17:00'] …)
 * @param {{start:number,end:number}[]} p.busy  UTC ms intervals
 * @param {string} p.tz
 * @param {number} [p.durationMinutes=60]
 * @param {number} [p.stepMinutes=60]
 * @param {number} [p.nowMs]           slots before now (+1h lead time) are dropped
 * @returns {{ label: string, startMs: number }[]}
 */
export function openSlots({ dateStr, hours, busy = [], tz, durationMinutes = 60, stepMinutes = 60, nowMs = Date.now() }) {
  const span = hours?.[dayKey(dateStr)];
  if (!span) return [];
  const [oh, om] = span[0].split(':').map(Number);
  const [ch, cm] = span[1].split(':').map(Number);
  const out = [];
  for (let t = oh * 60 + om; t + durationMinutes <= ch * 60 + cm; t += stepMinutes) {
    const h = Math.floor(t / 60), m = t % 60;
    const startMs = zonedToUtcMs(dateStr, h, m, tz);
    const endMs = startMs + durationMinutes * 60_000;
    if (startMs < nowMs + 60 * 60_000) continue;
    if (overlaps(startMs, endMs, busy)) continue;
    out.push({ label: label(h, m), startMs });
  }
  return out;
}

/** True if [startMs, startMs+duration) collides with any busy interval. */
export const isBusy = (startMs, durationMinutes, busy) => overlaps(startMs, startMs + durationMinutes * 60_000, busy);
