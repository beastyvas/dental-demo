import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCall, shouldTextBack, shouldNotifyOwner, ownerSummaryText, textBackText,
  toolNamesFromArtifact, isErrorEnd, LEAD_OUTCOMES,
} from '../lib/calls.js';

const tools = (...n) => new Set(n);

test('booked beats lead; emergency beats everything', () => {
  assert.equal(classifyCall({ leads: [{ notes: 'BOOKED — Tue at 2 PM' }] }), 'booked');
  assert.equal(classifyCall({ leads: [{ notes: 'BOOKED' }], tools: tools('sendEmergencyAlert') }), 'emergency');
  assert.equal(classifyCall({ leads: [{ notes: 'callback please' }] }), 'lead');
});

test('transfer, spam, error, hangup, info', () => {
  assert.equal(classifyCall({ endedReason: 'assistant-forwarded-call', durationSeconds: 40 }), 'transferred');
  assert.equal(classifyCall({ endedReason: 'customer-ended-call', durationSeconds: 60, structured: { is_spam: true } }), 'spam');
  assert.equal(classifyCall({ endedReason: 'pipeline-error-openai-llm-failed', durationSeconds: 12 }), 'error');
  assert.equal(classifyCall({ endedReason: 'customer-ended-call', durationSeconds: 8 }), 'hangup');
  assert.equal(classifyCall({ endedReason: 'customer-ended-call', durationSeconds: 90, structured: { need: 'hours' } }), 'info');
});

test('a captured lead is never a hangup or error', () => {
  assert.equal(classifyCall({ endedReason: 'pipeline-error-x', durationSeconds: 5, leads: [{ notes: '' }] }), 'lead');
});

test('normal ends are not errors', () => {
  for (const r of ['customer-ended-call', 'silence-timed-out', 'assistant-ended-call', 'exceeded-max-duration']) {
    assert.equal(isErrorEnd(r), false, r);
  }
  assert.equal(isErrorEnd('call.in-progress.error-vapifault-openai-llm-failed'), true);
});

test('text-back only for lost callers, once, never to opt-outs', () => {
  const p = { outcome: 'hangup', callerPhone: '+17025550000' };
  assert.equal(shouldTextBack(p), true);
  assert.equal(shouldTextBack({ ...p, outcome: 'error' }), true);
  assert.equal(shouldTextBack({ ...p, outcome: 'booked' }), false);
  assert.equal(shouldTextBack({ ...p, optedOut: true }), false);
  assert.equal(shouldTextBack({ ...p, textedRecently: true }), false);
  assert.equal(shouldTextBack({ ...p, callerPhone: null }), false);
});

test('owner is not pinged for spam or pocket dials', () => {
  assert.equal(shouldNotifyOwner({ outcome: 'spam', durationSeconds: 60 }), false);
  assert.equal(shouldNotifyOwner({ outcome: 'hangup', durationSeconds: 3 }), false);
  assert.equal(shouldNotifyOwner({ outcome: 'hangup', durationSeconds: 12 }), true);
  assert.equal(shouldNotifyOwner({ outcome: 'booked', durationSeconds: 3 }), true);
});

test('owner summary reads well', () => {
  const t = ownerSummaryText({
    businessName: 'Desert Air', outcome: 'booked', callerName: 'Jane', callerPhone: '+17025551234',
    need: 'AC not cooling', summary: 'Booked a diagnostic Tue 2 PM.', afterHours: true, dashboardUrl: 'https://x.app',
  });
  assert.match(t, /JOB BOOKED — Desert Air \(after hours\)/);
  assert.match(t, /Jane · \(702\) 555-1234/);
  assert.match(t, /Needs: AC not cooling/);
});

test('text-back carries opt-out language', () => {
  assert.match(textBackText({ businessName: 'Desert Air', callbackNumber: '+17025550000' }), /Reply STOP to opt out/);
});

test('tool names are pulled from artifact messages', () => {
  const names = toolNamesFromArtifact({ messages: [
    { role: 'tool_calls', toolCalls: [{ function: { name: 'bookAppointment' } }] },
    { role: 'bot', message: 'hi' },
  ] });
  assert.deepEqual([...names], ['bookAppointment']);
});

test('guarantee counter counts the right outcomes', () => {
  assert.deepEqual([...LEAD_OUTCOMES].sort(), ['booked', 'emergency', 'lead', 'transferred']);
});
