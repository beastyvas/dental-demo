import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optKeyword } from '../lib/optout.js';
import { computeTwilioSignature, isValidTwilioSignature } from '../lib/twilio.js';
import { toE164, prettyPhone } from '../lib/phone.js';
import { openSlots, zonedToUtcMs, isBusy } from '../lib/slots.js';
import { describeHours, isOpenAt } from '../lib/businessHours.js';

test('opt-out keywords', () => {
  for (const s of ['STOP', 'stop', ' Stop. ', 'unsubscribe', 'CANCEL', 'quit']) assert.equal(optKeyword(s), 'stop', s);
  for (const s of ['START', 'unstop']) assert.equal(optKeyword(s), 'start', s);
  for (const s of ['stop by tomorrow?', 'yes please call', 'hi']) assert.equal(optKeyword(s), null, s);
});

test("Twilio signature matches Twilio's documented example", () => {
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const params = { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' };
  assert.equal(computeTwilioSignature('12345', url, params), '0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
  assert.equal(isValidTwilioSignature({ authToken: '12345', signature: '0/KCTR6DLpKmkAf8muzZqo1nDgQ=', url, params }), true);
  assert.equal(isValidTwilioSignature({ authToken: '12345', signature: 'nope', url, params }), false);
  assert.equal(isValidTwilioSignature({ authToken: '12345', signature: undefined, url, params }), false);
});

test('phone normalization', () => {
  assert.equal(toE164('(702) 555-1234'), '+17025551234');
  assert.equal(toE164('17025551234'), '+17025551234');
  assert.equal(toE164('+17025551234'), '+17025551234');
  assert.equal(toE164('555-1234'), null);
  assert.equal(prettyPhone('+17025551234'), '(702) 555-1234');
});

test('wall clock → UTC across DST', () => {
  const tz = 'America/Los_Angeles';
  assert.equal(new Date(zonedToUtcMs('2026-07-01', 9, 0, tz)).toISOString(), '2026-07-01T16:00:00.000Z'); // PDT
  assert.equal(new Date(zonedToUtcMs('2026-12-01', 9, 0, tz)).toISOString(), '2026-12-01T17:00:00.000Z'); // PST
});

test('open slots skip busy time and closed days', () => {
  const tz = 'America/Los_Angeles';
  const hours = { tue: ['08:00', '12:00'] };
  const busy = [{ start: zonedToUtcMs('2026-10-20', 9, 30, tz), end: zonedToUtcMs('2026-10-20', 10, 30, tz) }];
  const labels = openSlots({ dateStr: '2026-10-20', hours, busy, tz, nowMs: 0 }).map((s) => s.label);
  assert.deepEqual(labels, ['8:00 AM', '11:00 AM']);
  assert.deepEqual(openSlots({ dateStr: '2026-10-21', hours, busy, tz, nowMs: 0 }), []); // Wednesday closed
  assert.equal(isBusy(zonedToUtcMs('2026-10-20', 10, 0, tz), 30, busy), true);
  assert.equal(isBusy(zonedToUtcMs('2026-10-20', 10, 30, tz), 30, busy), false);
});

test('slots too close to now are dropped', () => {
  const tz = 'America/Los_Angeles';
  const nowMs = zonedToUtcMs('2026-10-20', 9, 15, tz);
  const labels = openSlots({ dateStr: '2026-10-20', hours: { tue: ['08:00', '13:00'] }, tz, nowMs }).map((s) => s.label);
  assert.deepEqual(labels, ['11:00 AM', '12:00 PM']);
});

test('business hours', () => {
  const hours = { mon: ['07:00', '17:00'], tue: ['07:00', '17:00'], sat: ['08:00', '12:00'] };
  assert.equal(describeHours(hours), 'Mon–Tue 7:00 AM–5:00 PM, Sat 8:00 AM–12:00 PM');
  const tz = 'America/Los_Angeles';
  assert.equal(isOpenAt(new Date(zonedToUtcMs('2026-10-19', 7, 30, tz)), tz, hours), true);  // Mon 7:30
  assert.equal(isOpenAt(new Date(zonedToUtcMs('2026-10-19', 17, 0, tz)), tz, hours), false); // Mon 5:00 PM
  assert.equal(isOpenAt(new Date(zonedToUtcMs('2026-10-25', 9, 0, tz)), tz, hours), false);  // Sun
});
