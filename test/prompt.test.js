import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderPrompt, renderFirstMessage, TRADES } from '../lib/prompt.js';

const base = JSON.parse(readFileSync(new URL('../clients/example.json', import.meta.url)));

test('ships the four launch trades', () => {
  assert.deepEqual([...TRADES].sort(), ['emergency-trade', 'hvac', 'remodel', 'roofing']);
});

for (const trade of ['hvac', 'roofing', 'remodel', 'emergency-trade']) {
  test(`${trade}: renders fully, discloses AI, never hides it`, () => {
    const p = renderPrompt({ ...base, trade });
    assert.doesNotMatch(p, /\{\{\w+\}\}/, 'unfilled placeholder');
    assert.match(p, /never claim to be human/);
    assert.doesNotMatch(p, /never say you('re| are) an AI|real human receptionist/i);
    for (const tool of ['checkOfficeHours', 'checkAvailability', 'bookAppointment', 'addToWaitlist', 'sendEmergencyAlert']) {
      assert.match(p, new RegExp(tool), `mentions ${tool}`);
    }
  });
}

test('first message carries AI + recording disclosure', () => {
  const m = renderFirstMessage(base);
  assert.match(m, /an AI assistant/);
  assert.match(m, /this call may be recorded/);
});

test('no transfer number → no transferCall instructions', () => {
  const p = renderPrompt({ ...base, transfer_phone: null });
  assert.doesNotMatch(p, /use \*\*transferCall\*\*/);
  assert.match(p, /can't transfer calls/);
});

test('service fee flows into pricing answers', () => {
  assert.match(renderPrompt(base), /\$89, waived/);
  assert.doesNotMatch(renderPrompt({ ...base, service_fee: null }), /\$89/);
});
