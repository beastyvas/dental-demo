// Run with: node --test --experimental-test-module-mocks test/handlers.test.js
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './fake-db.js';
import { computeTwilioSignature } from '../lib/twilio.js';

const CLIENT = {
  id: 'c1', slug: 'desert-air', business_name: 'Desert Air', agent_id: 'asst_1', active: true,
  owner_phone: '+17025550101', twilio_number: '+17025559999', timezone: 'America/Los_Angeles',
  business_hours: null,
};

let db = createFakeDb();
// Delegate to whichever fake db the current test set up.
const proxy = { from: (table) => db.supabase.from(table) };
mock.module('../lib/supabase.js', {
  namedExports: {
    supabase: proxy,
    insertTolerant: (table, row) => proxy.from(table).insert([row]),
  },
});

const sent = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('api.twilio.com')) {
    const p = Object.fromEntries(new URLSearchParams(init.body));
    sent.push({ to: p.To, from: p.From, body: p.Body });
    return new Response(JSON.stringify({ sid: `SM${sent.length}`, status: 'queued' }), { status: 201 });
  }
  throw new Error(`unexpected fetch ${url}`);
};

process.env.TWILIO_ACCOUNT_SID = 'AC_test';
process.env.TWILIO_AUTH_TOKEN = 'tok_test';
process.env.VAPI_WEBHOOK_SECRET = 'shh';
process.env.ADMIN_ALERT_PHONE = '+17025550000';
process.env.DASHBOARD_URL = 'https://dash.example';

const { default: vapiEvents } = await import('../api/vapi/events.js');
const { default: twilioHook } = await import('../api/twilio/[event].js');

function res() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}

const report = (over = {}) => ({
  method: 'POST',
  headers: { 'x-vapi-secret': 'shh' },
  body: { message: {
    type: 'end-of-call-report',
    endedReason: 'customer-ended-call',
    startedAt: '2026-10-19T17:00:00.000Z', // Mon 10:00 AM PDT — open
    endedAt:   '2026-10-19T17:02:30.000Z',
    call: { id: 'call_1', assistantId: 'asst_1' },
    customer: { number: '+17025551234' },
    analysis: { summary: 'Caller booked an AC diagnostic.', structuredData: { caller_name: 'Jane', need: 'AC not cooling' } },
    artifact: { transcript: 'AI: Hi\nUser: my AC...', recordingUrl: 'https://rec/1.wav', messages: [] },
    cost: 0.21,
    ...over,
  } },
});

beforeEach(() => {
  db = createFakeDb({ clients: [CLIENT], waitlist: [], calls: [], messages: [], opt_outs: [] });
  sent.length = 0;
});

test('rejects a bad Vapi secret', async () => {
  const r = res();
  await vapiEvents({ ...report(), headers: { 'x-vapi-secret': 'wrong' } }, r);
  assert.equal(r.statusCode, 401);
});

test('booked call → calls row + owner summary, no text-back', async () => {
  db.tables.waitlist.push({ id: 'w1', vapi_call_id: 'call_1', notes: 'BOOKED — Tue at 2 PM', patient_name: 'Jane' });
  const r = res();
  await vapiEvents(report(), r);
  assert.equal(r.body.outcome, 'booked');
  const call = db.tables.calls[0];
  assert.equal(call.outcome, 'booked');
  assert.equal(call.duration_seconds, 150);
  assert.equal(call.after_hours, false);
  assert.equal(call.owner_notified, true);
  assert.equal(call.text_back_sent, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '+17025550101');
  assert.equal(sent[0].from, '+17025559999');
  assert.match(sent[0].body, /JOB BOOKED — Desert Air/);
  assert.equal(db.tables.messages[0].kind, 'owner_summary');
});

test('early hang-up → caller texted back once, owner told', async () => {
  const hang = report({ endedAt: '2026-10-19T17:00:09.000Z', analysis: { structuredData: {} } });
  await vapiEvents(hang, res());
  const toCaller = sent.filter((s) => s.to === '+17025551234');
  assert.equal(toCaller.length, 1);
  assert.match(toCaller[0].body, /sorry we didn't get to finish/);
  assert.match(sent.find((s) => s.to === '+17025550101').body, /We texted them back/);

  // Second hang-up from the same caller within 24h → no second text.
  sent.length = 0;
  await vapiEvents({ ...hang, body: { message: { ...hang.body.message, call: { id: 'call_2', assistantId: 'asst_1' } } } }, res());
  assert.equal(sent.filter((s) => s.to === '+17025551234').length, 0);
});

test('opted-out caller never gets a text-back', async () => {
  db.tables.opt_outs.push({ client_id: 'c1', phone: '+17025551234' });
  await vapiEvents(report({ endedAt: '2026-10-19T17:00:09.000Z', analysis: { structuredData: {} } }), res());
  assert.equal(sent.filter((s) => s.to === '+17025551234').length, 0);
});

test('agent error → caller texted, admin alerted', async () => {
  await vapiEvents(report({ endedReason: 'pipeline-error-openai-llm-failed', endedAt: '2026-10-19T17:00:20.000Z', analysis: { structuredData: {} } }), res());
  assert.ok(sent.some((s) => s.to === '+17025551234'));
  assert.ok(sent.some((s) => s.to === '+17025550000' && /Vapi call error/.test(s.body)));
});

test('re-delivered report updates the same calls row', async () => {
  await vapiEvents(report(), res());
  await vapiEvents(report(), res());
  assert.equal(db.tables.calls.length, 1);
});

const twilioReq = (body, { badSig = false } = {}) => {
  const url = 'https://dash.example/api/twilio/sms';
  return {
    method: 'POST',
    url: '/api/twilio/sms',
    query: { event: 'sms' },
    headers: {
      host: 'dash.example', 'x-forwarded-proto': 'https',
      'x-twilio-signature': badSig ? 'bogus' : computeTwilioSignature('tok_test', url, body),
    },
    body,
  };
};

test('Twilio webhook rejects unsigned requests', async () => {
  const r = res();
  await twilioHook(twilioReq({ From: '+17025551234', To: '+17025559999', Body: 'hi' }, { badSig: true }), r);
  assert.equal(r.statusCode, 403);
});

test('STOP records an opt-out; START removes it', async () => {
  await twilioHook(twilioReq({ From: '+17025551234', To: '+17025559999', Body: 'STOP', MessageSid: 'SM1' }), res());
  assert.deepEqual(db.tables.opt_outs.map((o) => [o.client_id, o.phone]), [['c1', '+17025551234']]);
  assert.equal(sent.length, 0, 'no forward to owner for STOP');
  await twilioHook(twilioReq({ From: '+17025551234', To: '+17025559999', Body: 'start' }), res());
  assert.equal(db.tables.opt_outs.length, 0);
});

test('signature still validates when Vercel appends ?event=sms', async () => {
  const body = { From: '+17025551234', To: '+17025559999', Body: 'STOP' };
  const req = twilioReq(body);
  req.url = '/api/twilio/sms?event=sms';
  const r = res();
  await twilioHook(req, r);
  assert.equal(r.statusCode, 200);
});

test('a normal reply is forwarded to the owner', async () => {
  const r = res();
  await twilioHook(twilioReq({ From: '+17025551234', To: '+17025559999', Body: 'Can you come Thursday?' }), r);
  assert.equal(r.headers['Content-Type'], 'text/xml');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '+17025550101');
  assert.match(sent[0].body, /Can you come Thursday\?/);
  assert.equal(db.tables.messages.filter((m) => m.direction === 'inbound').length, 1);
});
