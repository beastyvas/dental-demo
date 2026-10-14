/**
 * Phone-number helpers. Everything we store and compare is E.164 (+17025551234)
 * so "702-555-1234", "(702) 555-1234" and "+17025551234" are the same caller.
 */

/** Best-effort E.164 for US numbers. Returns null if it can't be a phone number. */
export function toE164(input) {
  if (!input) return null;
  const s = String(input).trim();
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+') && digits.length >= 10) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** "(702) 555-1234" for humans. Falls back to the raw input. */
export function prettyPhone(input) {
  const e = toE164(input);
  const m = e?.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(input ?? '');
}
