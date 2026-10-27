// Run with: node --test --experimental-test-module-mocks test/jobs.test.js
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createFakeDb } from './fake-db.js';

let db = createFakeDb();
const proxy = { from: (table) => db.supabase.from(table) };
mock.module('../lib/supabase.js', {
  namedExports: { supabase: proxy, insertTolerant: (table, row) => proxy.from(table).insert([row]) },
});

const sent = [];
const jobberCalls = [];
let graphqlResponse = null;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
  if (u.includes('api.twilio.com')) {
    const p = Object.fromEntries(new URLSearchParams(init.body));
    sent.push({ to: p.To, from: p.From, body: p.Body });
    return json({ sid: `SM${sent.length}`, status: 'queued' }, 201);
  }
  if (u === 'https://api.getjobber.com/api/oauth/token') {
    const p = Object.fromEntries(new URLSearchParams(init.body));
    jobberCalls.push({ token: p.grant_type, version: null });
    return json({ access_token: `at_${p.grant_type}`, refresh_token: `rt_${jobberCalls.length}`, expires_in: 3600 });
  }
  if (u === 'https://api.getjobber.com/api/graphql') {
    const q = JSON.parse(init.body).query;
    jobberCalls.push({ graphql: q.match(/\{\s*(\w+)/)[1], auth: init.headers.Authorization, version: init.headers['X-JOBBER-GRAPHQL-VERSION'] });
    if (q.includes('account')) return json({ data: { account: { id: 'acct_1', name: 'Desert Air LLC' } } });
    return json({ data: graphqlResponse });
  }
  throw new Error(`unexpected fetch ${u}`);
};

Object.assign(process.env, {
  TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 'tok', JWT_SECRET: 'jwt', DASHBOARD_URL: 'https://rx.example',
  JOBBER_CLIENT_ID: 'jid', JOBBER_CLIENT_SECRET: 'jsecret', ADMIN_API_SECRET: 'admin',
});

const { createLead, setLeadStatus } = await import('../lib/leads.js');
const { processDue } = await import('../lib/followups.js');
const { default: leadsApi } = await import('../api/leads/[source].js');
const { default: admin } = await import('../lib/handlers/admin.js');
const jobber = await import('../lib/jobber.js');
const { hcpCustomer } = await import('../lib/handlers/job-events.js');

const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const CLIENT = {
  id: 'c1', slug: 'desert-air', business_name: 'Desert Air', active: true, status: 'live', lead_key: KEY,
  owner_phone: '+17025550101', twilio_number: '+17025559999', timezone: 'America/Los_Angeles', integrations: {},
};
const T0 = new Date('2026-10-27T17:00:00Z'); // Tue 10am PDT

function res() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
}

beforeEach(() => {
  db = createFakeDb({ clients: [structuredClone(CLIENT)], client_leads: [], followups: [], messages: [], opt_outs: [], review_requests: [] });
  sent.length = 0;
  jobberCalls.length = 0;
});

test('"Job done" queues a review request; the cron sends it with the rating link', async () => {
  const { lead } = await createLead(CLIENT, { source: 'form', name: 'Sarah Connor', phone: '7025551234' }, { now: T0 });
  const { automations } = await setLeadStatus(CLIENT, lead, 'job_done', {}, { now: T0 });
  assert.match(automations[0], /Review request goes out in about 60 minutes/);
  const f = db.tables.followups[0];
  assert.equal(f.kind, 'review');
  assert.equal((new Date(f.send_at) - T0) / 60_000, 60);

  const r = await processDue({ now: new Date(T0.getTime() + 61 * 60_000) });
  assert.equal(r.sent, 1);
  assert.equal(db.tables.review_requests.length, 1);
  assert.match(sent[0].body, new RegExp(`^Hi Sarah Connor! Thanks for choosing Desert Air.*https://rx.example/review/${db.tables.review_requests[0].id}`));
});

test('no repeat review request within 90 days; delay is capped under 2 hours', async () => {
  db.tables.clients[0].automation = { review_delay_min: 500 };
  const client = db.tables.clients[0];
  const { lead } = await createLead(client, { source: 'form', phone: '7025551234' }, { now: T0 });
  await setLeadStatus(client, lead, 'job_done', {}, { now: T0 });
  assert.equal((new Date(db.tables.followups[0].send_at) - T0) / 60_000, 110);
  const again = await setLeadStatus(client, { ...lead, status: 'won' }, 'job_done', {}, { now: T0 });
  assert.match(again.automations[0], /Already asked/);
  assert.equal(db.tables.followups.length, 1);
});

test('review requests may go out until 9pm, then wait for morning', async () => {
  const { lead } = await createLead(CLIENT, { source: 'form', phone: '7025551234' }, { now: T0 });
  await setLeadStatus(CLIENT, lead, 'job_done', {}, { now: new Date('2026-10-28T02:00:00Z') }); // 7pm PDT → due 8pm
  let r = await processDue({ now: new Date('2026-10-28T03:05:00Z') }); // 8:05pm
  assert.equal(r.sent, 1);
  db.tables.followups[0].status = 'pending';
  r = await processDue({ now: new Date('2026-10-28T04:30:00Z') }); // 9:30pm
  assert.equal(r.deferred, 1);
});

// ── Jobber ────────────────────────────────────────────────────────────────

test('Jobber connect link → callback saves tokens + account; admin never exposes tokens', async () => {
  let r = res();
  await admin({ method: 'POST', headers: { authorization: 'Bearer admin' }, query: { action: 'jobber-connect' }, body: { client_id: 'c1' } }, r);
  assert.equal(r.statusCode, 200);
  const state = new URL(r.body.url).searchParams.get('state');
  assert.equal(new URL(r.body.url).searchParams.get('redirect_uri'), 'https://rx.example/api/leads/jobber-callback');

  r = res();
  await leadsApi({ method: 'GET', query: { source: 'jobber-callback', state: 'c1.forged', code: 'x' }, headers: {} }, r);
  assert.equal(r.statusCode, 400);

  r = res();
  await leadsApi({ method: 'GET', query: { source: 'jobber-callback', state, code: 'code_1' }, headers: {} }, r);
  assert.equal(r.statusCode, 200, r.body);
  const j = db.tables.clients[0].integrations.jobber;
  assert.equal(j.account_id, 'acct_1');
  assert.equal(j.access_token, 'at_authorization_code');

  r = res();
  await admin({ method: 'GET', headers: { authorization: 'Bearer admin' }, query: { action: 'status', client_id: 'c1' } }, r);
  assert.deepEqual(r.body.client.integrations.jobber.connected, true);
  assert.equal(JSON.stringify(r.body).includes('at_authorization_code'), false, 'no tokens in the API');
  assert.match(r.body.leadCapture.hcpWebhookUrl, /\/api\/leads\/hcp\?key=/);
});

function signedJobber(payload) {
  const raw = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', 'jsecret').update(raw).digest('base64');
  return { method: 'POST', query: { source: 'jobber' }, headers: { 'x-jobber-hmac-sha256': sig }, body: raw };
}

test('Jobber VISIT_COMPLETE → refreshes token, fetches the customer, queues the review', async () => {
  db.tables.clients[0].integrations = { jobber: { account_id: 'acct_1', access_token: 'old', refresh_token: 'rt_0', expires_at: '2000-01-01T00:00:00Z' } };
  graphqlResponse = { visit: { id: 'v1', title: 'AC repair', job: { id: 'j1', title: 'AC repair', client: {
    id: 'jc1', name: 'Pat Lee', phones: [{ number: '(702) 555-7777', primary: true }], emails: [{ address: 'pat@x.com', primary: true }],
  } } } };
  const r = res();
  await leadsApi(signedJobber({ data: { webHookEvent: { topic: 'VISIT_COMPLETE', accountId: 'acct_1', itemId: 'v1' } } }), r);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'job_done');
  assert.equal(jobberCalls[0].token, 'refresh_token');
  assert.equal(jobberCalls[1].auth, 'Bearer at_refresh_token');
  assert.equal(jobberCalls[1].version, '2025-04-16');
  assert.equal(db.tables.clients[0].integrations.jobber.refresh_token, 'rt_1', 'rotated refresh token saved');
  const lead = db.tables.client_leads[0];
  assert.deepEqual([lead.source, lead.phone, lead.status], ['jobber', '+17025557777', 'job_done']);
  assert.equal(db.tables.followups[0].kind, 'review');
});

test('Jobber QUOTE_SENT on an existing lead starts the estimate follow-up', async () => {
  db.tables.clients[0].integrations = { jobber: { account_id: 'acct_1', access_token: 'live', refresh_token: 'rt', expires_at: '2999-01-01T00:00:00Z' } };
  await createLead(CLIENT, { source: 'call', phone: '7025557777', status: 'contacted' });
  graphqlResponse = { quote: { id: 'q1', title: 'Roof', client: { id: 'jc1', name: 'Pat', phones: [{ number: '7025557777' }], emails: [] } } };
  const r = res();
  await leadsApi(signedJobber({ data: { webHookEvent: { topic: 'QUOTE_SENT', accountId: 'acct_1', itemId: 'q1' } } }), r);
  assert.equal(r.body.status, 'estimate_sent');
  assert.equal(db.tables.client_leads.length, 1, 'matched the existing lead by phone');
  assert.equal(db.tables.followups.filter((f) => f.kind === 'estimate').length, 5);
});

test('Jobber: bad signature 401, unknown topic and unknown account ignored', async () => {
  let r = res();
  await leadsApi({ ...signedJobber({ data: { webHookEvent: { topic: 'VISIT_COMPLETE', accountId: 'acct_1', itemId: 'v1' } } }), headers: { 'x-jobber-hmac-sha256': 'nope' } }, r);
  assert.equal(r.statusCode, 401);
  r = res();
  await leadsApi(signedJobber({ data: { webHookEvent: { topic: 'CLIENT_CREATE', accountId: 'acct_1', itemId: 'x' } } }), r);
  assert.equal(r.body.ignored, 'CLIENT_CREATE');
  r = res();
  await leadsApi(signedJobber({ data: { webHookEvent: { topic: 'JOB_CLOSED', accountId: 'acct_other', itemId: 'x' } } }), r);
  assert.match(r.body.ignored, /no business/);
});

// ── Housecall Pro + generic ───────────────────────────────────────────────

test('Housecall Pro job.completed → job done → review queued; wrong key 404', async () => {
  let r = res();
  await leadsApi({ method: 'POST', query: { source: 'hcp', key: KEY }, headers: {},
    body: { event: 'job.completed', job: { id: 'job_1', description: 'Water heater', customer: { id: 'cus_1', first_name: 'Ana', last_name: 'Ruiz', mobile_number: '7025558888' } } } }, r);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(db.tables.client_leads[0].name, 'Ana Ruiz');
  assert.equal(db.tables.followups[0].kind, 'review');
  r = res();
  await leadsApi({ method: 'POST', query: { source: 'hcp', key: 'wrong-key-123' }, headers: {}, body: {} }, r);
  assert.equal(r.statusCode, 404);
  assert.deepEqual(hcpCustomer({ customer: { name: 'Bo', home_number: '7025550000' } }).phone, '7025550000');
});

test('generic job-complete webhook', async () => {
  const r = res();
  await leadsApi({ method: 'POST', query: { source: 'job-complete', key: KEY }, headers: {}, body: { name: 'Kim', phone: '702-555-1212' } }, r);
  assert.equal(r.body.status, 'job_done');
});
