// Run with: node --test --experimental-test-module-mocks test/followups.test.js
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './fake-db.js';
import { computeTwilioSignature } from '../lib/twilio.js';

let db = createFakeDb();
const proxy = { from: (table) => db.supabase.from(table) };
mock.module('../lib/supabase.js', {
  namedExports: { supabase: proxy, insertTolerant: (table, row) => proxy.from(table).insert([row]) },
});

const sent = [];
globalThis.fetch = async (url, init = {}) => {
  if (String(url).includes('api.twilio.com')) {
    const p = Object.fromEntries(new URLSearchParams(init.body));
    sent.push({ to: p.To, from: p.From, body: p.Body });
    return new Response(JSON.stringify({ sid: `SM${sent.length}`, status: 'queued' }), { status: 201 });
  }
  throw new Error(`unexpected fetch ${url}`);
};

Object.assign(process.env, {
  TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 'tok_test', JWT_SECRET: 'jwt', CRON_SECRET: 'cron', DASHBOARD_URL: 'https://dash.example',
});

const { createLead, setLeadStatus } = await import('../lib/leads.js');
const { processDue, quietUntil } = await import('../lib/followups.js');
const { default: cron } = await import('../api/cron/[job].js');
const { default: twilioHook } = await import('../api/twilio/[event].js');

const CLIENT = {
  id: 'c1', slug: 'desert-air', business_name: 'Desert Air', active: true, status: 'live',
  owner_phone: '+17025550101', twilio_number: '+17025559999', timezone: 'America/Los_Angeles',
  config: { owner_name: 'Mike' },
};
const DAY = 86_400_000;
// Tue Oct 27 2026, 10:00 Las Vegas (PDT)
const T0 = new Date('2026-10-27T17:00:00Z');

function res() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
}

async function estimateLead() {
  const { lead } = await createLead(CLIENT, { source: 'form', name: 'Sarah Connor', phone: '7025551234' }, { now: T0 });
  return setLeadStatus(CLIENT, lead, 'estimate_sent', {}, { now: T0 });
}

function inbound(body, from = '+17025551234') {
  const params = { From: from, To: '+17025559999', Body: body, MessageSid: 'SMx' };
  const sig = computeTwilioSignature('tok_test', 'https://dash.example/api/twilio/sms', params);
  return twilioHook({
    method: 'POST', query: { event: 'sms' }, body: params, url: '/api/twilio/sms',
    headers: { 'x-twilio-signature': sig, host: 'dash.example', 'x-forwarded-proto': 'https' },
  }, res());
}

beforeEach(() => {
  db = createFakeDb({ clients: [structuredClone(CLIENT)], client_leads: [], followups: [], messages: [], opt_outs: [] });
  sent.length = 0;
});

test('"Estimate sent" schedules 5 texts on days 2/5/9/14/21 in the owner\'s voice', async () => {
  const { automations } = await estimateLead();
  assert.match(automations[0], /5 follow-up texts scheduled over 21 days/);
  const f = db.tables.followups;
  assert.equal(f.length, 5);
  assert.deepEqual(f.map((x) => (new Date(x.send_at) - T0) / DAY), [2, 5, 9, 14, 21]);
  assert.match(f[0].body, /^Hi Sarah, it's Mike with Desert Air/);
  assert.ok(f.every((x) => x.kind === 'estimate' && x.status === 'pending' && x.to_phone === '+17025551234'));
});

test('processDue sends what is due, from the AI line, and nothing early', async () => {
  await estimateLead();
  let r = await processDue({ now: new Date(T0.getTime() + DAY) });
  assert.equal(r.sent, 0);
  r = await processDue({ now: new Date(T0.getTime() + 2 * DAY) });
  assert.equal(r.sent, 1);
  assert.equal(sent[0].from, '+17025559999');
  assert.equal(db.tables.followups[0].status, 'sent');
});

test('quiet hours: a text due at 9pm waits until 8am', async () => {
  await estimateLead();
  const ninePm = new Date('2026-10-30T04:00:00Z'); // Thu 9pm PDT, after step 1 is due
  const r = await processDue({ now: ninePm });
  assert.equal(r.deferred, 1);
  assert.equal(sent.length, 0);
  assert.equal(db.tables.followups[0].send_at, '2026-10-30T15:00:00.000Z'); // Fri 8am PDT
  assert.equal(quietUntil(new Date('2026-10-30T18:00:00Z'), 'America/Los_Angeles'), null);
});

test('a reply stops the sequence, marks the lead replied, and tells the owner', async () => {
  await estimateLead();
  await inbound('Sounds good, can you come Thursday?');
  assert.ok(db.tables.followups.every((x) => x.status === 'cancelled'));
  assert.equal(db.tables.client_leads[0].status, 'replied');
  assert.match(sent.at(-1).body, /Follow-up texts stopped/);
  assert.equal(sent.at(-1).to, '+17025550101');
});

test('STOP cancels everything pending for that number', async () => {
  await estimateLead();
  await inbound('STOP');
  assert.ok(db.tables.followups.every((x) => x.status === 'cancelled'));
  assert.equal(db.tables.opt_outs.length, 1);
});

test('won / lost / moving off "estimate sent" stops it; due texts re-check the lead', async () => {
  const { lead } = await estimateLead();
  const out = await setLeadStatus(CLIENT, lead, 'won', {}, { now: T0 });
  assert.match(out.automations[0], /Stopped 5 follow-up texts/);
  assert.ok(db.tables.followups.every((x) => x.status === 'cancelled'));

  // Even if a cancel was missed, a due estimate text checks the lead first.
  db.tables.followups.forEach((x) => { x.status = 'pending'; });
  const r = await processDue({ now: new Date(T0.getTime() + 3 * DAY) });
  assert.equal(r.cancelled, 1);
  assert.equal(sent.length, 0);
});

test('paused or cancelled businesses send nothing', async () => {
  await estimateLead();
  db.tables.clients[0].status = 'paused';
  const r = await processDue({ now: new Date(T0.getTime() + 2 * DAY) });
  assert.equal(r.skipped, 1);
  assert.equal(sent.length, 0);
});

test('cron route requires the secret and runs the followups job', async () => {
  let r = res();
  await cron({ query: { job: 'followups' }, headers: {} }, r);
  assert.equal(r.statusCode, 401);
  r = res();
  await cron({ query: { job: 'followups' }, headers: { authorization: 'Bearer cron' } }, r);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['cancelled', 'deferred', 'failed', 'sent', 'skipped']);
  r = res();
  await cron({ query: { job: 'nope' }, headers: { authorization: 'Bearer cron' } }, r);
  assert.equal(r.statusCode, 404);
});
