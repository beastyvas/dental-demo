// Run with: node --test --experimental-test-module-mocks test/reactivation.test.js
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
Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 'tok_test', ADMIN_API_SECRET: 'admin', DASHBOARD_URL: 'https://dash.example' });

const { sendTimes } = await import('../lib/reactivation.js');
const { processDue } = await import('../lib/followups.js');
const { default: admin } = await import('../lib/handlers/admin.js');
const { default: twilioHook } = await import('../api/twilio/[event].js');

const CLIENT = {
  id: 'c1', slug: 'desert-air', business_name: 'Desert Air', active: true, status: 'live',
  owner_phone: '+17025550101', twilio_number: '+17025559999', timezone: 'America/Los_Angeles', config: { owner_name: 'Mike' },
};
const call = (body) => { const r = { statusCode: 200 }; r.status = (c) => (r.statusCode = c, r); r.json = (b) => (r.body = b, r);
  return admin({ method: 'POST', headers: { authorization: 'Bearer admin' }, query: { action: 'reactivation' }, body: { client_id: 'c1', ...body } }, r).then(() => r); };

beforeEach(() => {
  db = createFakeDb({ clients: [structuredClone(CLIENT)], client_leads: [], followups: [], messages: [], opt_outs: [] });
  sent.length = 0;
});

const ROWS = [
  { name: 'Ann Lee', phone: '702-555-0001', last_service: 'AC tune-up' },
  { name: 'Bo', phone: '(702) 555-0002', last_service: '' },
  { name: 'Ann again', phone: '7025550001' },
  { name: 'Bad', phone: '123' },
  { name: 'Opted out', phone: '702-555-0003' },
  { name: 'In pipeline', phone: '702-555-0004' },
];

test('dry run previews and counts what would be skipped; nothing is scheduled', async () => {
  db.tables.opt_outs.push({ client_id: 'c1', phone: '+17025550003' });
  db.tables.client_leads.push({ id: 'l1', client_id: 'c1', phone: '+17025550004', status: 'estimate_sent' });
  const r = await call({ rows: ROWS, dry_run: true });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.scheduled, 2);
  assert.deepEqual(r.body.skipped, { invalid: 1, duplicate: 1, optedOut: 1, active: 1 });
  assert.equal(r.body.preview[0].body, "Hi Ann, it's Mike with Desert Air. It's been a while since your AC tune-up — want us to take a look before the busy season? Reply YES and we'll set it up.");
  assert.match(r.body.preview[1].body, /since your last service/);
  assert.equal(db.tables.followups.length, 0);
});

test('sending requires the consent attestation; then schedules paced texts', async () => {
  let r = await call({ rows: ROWS.slice(0, 2) });
  assert.equal(r.statusCode, 400);
  r = await call({ rows: ROWS.slice(0, 2), consent_attested: true });
  assert.equal(r.body.scheduled, 2);
  assert.equal(db.tables.followups.length, 2);
  const [a, b] = db.tables.followups.map((f) => new Date(f.send_at));
  assert.equal((b - a) / 60_000, 1, '60 an hour → 1 minute apart');
  r = await call({ cancel: true });
  assert.equal(r.body.cancelled, 2);
});

test('pacing skips quiet hours instead of bunching at 8am', () => {
  const t = sendTimes(3, { now: new Date('2026-10-28T02:58:00Z'), perHour: 60, tz: 'America/Los_Angeles', auto: { quiet_start: 20, quiet_end: 8 } }); // 7:58pm PDT
  assert.deepEqual(t.map((d) => d.toISOString()), ['2026-10-28T02:58:00.000Z', '2026-10-28T02:59:00.000Z', '2026-10-28T15:00:00.000Z']);
});

test('a reply to a reactivation text becomes a lead and reaches the owner', async () => {
  await call({ rows: ROWS.slice(0, 1), consent_attested: true });
  await processDue({ now: new Date(Date.now() + 1000) }).catch(() => {});
  db.tables.followups[0].status = 'sent';
  db.tables.followups[0].sent_at = new Date().toISOString();
  const params = { From: '+17025550001', To: '+17025559999', Body: 'YES please', MessageSid: 'SMx' };
  const r = { statusCode: 200 }; r.status = (c) => (r.statusCode = c, r); r.send = () => r; r.setHeader = () => r; r.json = () => r;
  await twilioHook({ method: 'POST', query: { event: 'sms' }, body: params, url: '/api/twilio/sms',
    headers: { 'x-twilio-signature': computeTwilioSignature('tok_test', 'https://dash.example/api/twilio/sms', params), host: 'dash.example', 'x-forwarded-proto': 'https' } }, r);
  const lead = db.tables.client_leads.find((l) => l.phone === '+17025550001');
  assert.deepEqual([lead?.source, lead?.status, lead?.message], ['reactivation', 'replied', 'YES please']);
  assert.match(sent.at(-1).body, /YES please/);
});
