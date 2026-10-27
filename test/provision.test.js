// Run with: node --test --experimental-test-module-mocks test/provision.test.js
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './fake-db.js';

let db = createFakeDb();
const proxy = { from: (table) => db.supabase.from(table) };
mock.module('../lib/supabase.js', {
  namedExports: {
    supabase: proxy,
    insertTolerant: (table, row) => proxy.from(table).insert([row]),
  },
});

// Fake Vapi + Twilio. Records every call as "METHOD host/path".
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = init.method ?? 'GET';
  calls.push(`${method} ${u.host}${u.pathname}`);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  if (u.host === 'api.vapi.ai') {
    if (u.pathname === '/assistant/asst_template') return json({ model: { provider: 'openai', model: 'gpt-4o' }, voice: { provider: '11labs' } });
    if (method === 'POST' && u.pathname === '/assistant') return json({ id: 'asst_new' }, 201);
    if (method === 'PATCH' && u.pathname.startsWith('/assistant/')) return json({ id: u.pathname.split('/')[2] });
    if (method === 'POST' && u.pathname === '/phone-number') return json({ id: 'pn_new' }, 201);
    if (method === 'PATCH' && u.pathname.startsWith('/phone-number/')) return json({ id: u.pathname.split('/')[2] });
  }
  if (u.host === 'api.twilio.com') {
    if (u.pathname.endsWith('/AvailablePhoneNumbers/US/Local.json')) return json({ available_phone_numbers: [{ phone_number: '+17025550199' }] });
    if (method === 'POST' && u.pathname.endsWith('/IncomingPhoneNumbers.json')) return json({ sid: 'PN_bought', phone_number: '+17025550199' }, 201);
    if (method === 'POST' && u.pathname.includes('/IncomingPhoneNumbers/')) return json({ sid: 'PN_bought' });
    if (u.pathname.endsWith('/Messages.json')) return json({ sid: 'SM1', status: 'queued' }, 201);
  }
  if (u.host === 'messaging.twilio.com') return json({ code: 21710, message: 'already in service' }, 409);
  throw new Error(`unexpected fetch ${method} ${url}`);
};

Object.assign(process.env, {
  VAPI_API_KEY: 'vk', VAPI_WEBHOOK_SECRET: 'shh', TEMPLATE_ASSISTANT_ID: 'asst_template',
  TWILIO_ACCOUNT_SID: 'AC_test', TWILIO_AUTH_TOKEN: 'tok', SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x',
  ADMIN_API_SECRET: 'admin-secret', DEPLOYMENT_URL: 'https://rx.example', TWILIO_MESSAGING_SERVICE_SID: 'MG1',
  TWILIO_DEFAULT_FROM: '+17025550000',
});

const { validateConfig, configFromClient, provisionClient, forwardingCodes, previewClient } = await import('../lib/provision.js');
const { default: admin } = await import('../lib/handlers/admin.js');

// A row as the CRM creates it at "close deal": no assistant, no password.
const ONBOARDING = {
  id: 'c_new', slug: 'desert-air', business_name: 'Desert Air', agent_id: null, dashboard_password: null,
  active: false, status: 'onboarding', onboarding_steps: {}, timezone: 'America/Los_Angeles',
  config: { trade: 'hvac', agent_name: 'Riley', owner_name: 'Mike', owner_phone: '702-555-0101', area_code: '702' },
};

function res() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const adminReq = (action, body, { method = 'POST', auth = 'Bearer admin-secret' } = {}) => ({
  method, headers: auth ? { authorization: auth } : {}, query: { action, ...(method === 'GET' ? body : {}) }, body,
});

beforeEach(() => {
  db = createFakeDb({ clients: [structuredClone(ONBOARDING)], calls: [], messages: [], opt_outs: [] });
  calls.length = 0;
});

test('validateConfig flags missing fields, bad trade and bad phones', () => {
  assert.deepEqual(validateConfig(configFromClient(ONBOARDING)), []);
  const p = validateConfig({ slug: 's', business_name: 'B', trade: 'plumbing', agent_name: 'A', owner_name: 'O', owner_phone: '123' });
  assert.ok(p.some((x) => x.startsWith('trade must be one of')));
  assert.ok(p.includes('"owner_phone" isn\'t a valid phone number'));
  assert.ok(validateConfig({ ...configFromClient(ONBOARDING) }, { buyNumber: false }).some((x) => x.includes('twilio_number')));
});

test('configFromClient: config wins over columns, slug/name come from the row', () => {
  const cfg = configFromClient({ ...ONBOARDING, trade: 'roofing', config: { ...ONBOARDING.config, slug: 'other', business_name: 'Other' } });
  assert.equal(cfg.trade, 'hvac');
  assert.equal(cfg.slug, 'desert-air');
  assert.equal(cfg.business_name, 'Desert Air');
  assert.equal(cfg.timezone, 'America/Los_Angeles');
});

test('previewClient renders the disclosure greeting and the prompt', () => {
  const { firstMessage, systemPrompt } = previewClient(configFromClient(ONBOARDING));
  assert.match(firstMessage, /Desert Air, this is Riley, an AI assistant/);
  assert.ok(systemPrompt.includes('Desert Air'));
});

test('forwardingCodes', () => {
  const codes = forwardingCodes('+17025550199');
  assert.equal(codes[0].code, '*717025550199');
  assert.equal(codes[1].code, '*004*7025550199#');
});

test('provisionClient on a CRM-created row: creates assistant, buys number, fills the row', async () => {
  const r = await provisionClient(configFromClient(ONBOARDING), { buyNumber: true, baseUrl: 'https://rx.example/' });
  assert.equal(r.isNew, true);
  assert.equal(r.number, '+17025550199');
  assert.match(r.password, /^\d{6}$/);
  const row = db.tables.clients.find((c) => c.slug === 'desert-air');
  assert.equal(db.tables.clients.length, 1, 'updates the onboarding row, no duplicate');
  assert.equal(row.agent_id, 'asst_new');
  assert.equal(row.vapi_phone_number_id, 'pn_new');
  assert.equal(row.owner_phone, '+17025550101');
  assert.equal(row.active, true);
  assert.equal(row.status, 'onboarding', 'provisioning does not take the client live');
  assert.equal(row.config.twilio_number, '+17025550199');
  assert.ok(calls.includes('POST api.vapi.ai/assistant'));
  assert.ok(calls.includes('POST api.vapi.ai/phone-number'));
});

test('provisionClient re-run patches instead of creating, keeps the password', async () => {
  const first = await provisionClient(configFromClient(ONBOARDING), { buyNumber: true, baseUrl: 'https://rx.example' });
  calls.length = 0;
  const again = await provisionClient(configFromClient(db.tables.clients[0]), { baseUrl: 'https://rx.example' });
  assert.equal(again.isNew, false);
  assert.equal(again.password, first.password);
  assert.ok(calls.includes('PATCH api.vapi.ai/assistant/asst_new'));
  assert.ok(calls.includes('PATCH api.vapi.ai/phone-number/pn_new'));
  assert.ok(!calls.some((c) => c.endsWith('/AvailablePhoneNumbers/US/Local.json')), 'no second number bought');
});

test('provisionClient refuses an invalid config before touching any API', async () => {
  await assert.rejects(provisionClient({ ...configFromClient(ONBOARDING), trade: 'nope' }, { baseUrl: 'https://rx.example' }), /trade must be one of/);
  assert.equal(calls.length, 0);
});

test('admin API rejects a missing or wrong secret', async () => {
  for (const auth of [null, 'Bearer nope', 'admin-secret']) {
    const r = res();
    await admin(adminReq('status', { client_id: 'c_new' }, { method: 'GET', auth }), r);
    assert.equal(r.statusCode, 401, String(auth));
  }
});

test('admin provision → status → a2p → credentials', async () => {
  let r = res();
  await admin(adminReq('provision', { client_id: 'c_new', buy_number: true }), r);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.client.dashboard_password, undefined, 'password never leaves the API');
  assert.equal(r.body.client.has_password, true);
  assert.equal(r.body.client.onboarding_steps.provisioned.done, true);

  r = res();
  await admin(adminReq('status', { client_id: 'c_new' }, { method: 'GET' }), r);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body.problems, []);
  assert.equal(r.body.forwarding.length, 4);
  assert.equal(r.body.a2pAvailable, true);

  r = res();
  await admin(adminReq('a2p-attach', { client_id: 'c_new' }), r);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.alreadyAttached, true);

  r = res();
  await admin(adminReq('send-credentials', { client_id: 'c_new' }), r);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const steps = db.tables.clients[0].onboarding_steps;
  assert.ok(steps.provisioned.done && steps.a2p.done && steps.credentials.done);
  assert.equal(db.tables.messages.length, 1);
  assert.equal(db.tables.messages[0].from_number, '+17025550000');
});

test('admin preview returns problems without rendering when trade is missing', async () => {
  db.tables.clients[0].config = { ...ONBOARDING.config, trade: null };
  const r = res();
  await admin(adminReq('preview', { client_id: 'c_new' }), r);
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.problems.includes('missing "trade"'));
  assert.equal(r.body.systemPrompt, undefined);
});

test('admin send-credentials before provisioning is a 400', async () => {
  const r = res();
  await admin(adminReq('send-credentials', { client_id: 'c_new' }), r);
  assert.equal(r.statusCode, 400);
});
