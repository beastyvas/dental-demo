/**
 * Carrier-standard opt-out keywords. Twilio also blocks STOP'd numbers at the
 * carrier level; we record them so our own sends skip them up front.
 */
const STOP  = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT']);
const START = new Set(['START', 'UNSTOP', 'YES', 'SUBSCRIBE']);

/** 'stop' | 'start' | null for an inbound message body. */
export function optKeyword(body) {
  const word = String(body ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (STOP.has(word)) return 'stop';
  if (START.has(word)) return 'start';
  return null;
}
