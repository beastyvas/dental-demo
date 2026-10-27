// Run with: node --test --experimental-test-module-mocks test/a2p.test.js
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './fake-db.js';

let db = createFakeDb();
const proxy = { from: (table) => db.supabase.from(table) };
mock.module('../lib/supabase.js', { namedExports: { supabase: proxy, insertTolerant: () => ({}) } });

// Fake Twilio: records calls; statuses are flipped by the tests.
const calls = [];
const state = { profile: 'pending-review', trust: 'pending-review', brand: 'PENDING', campaign: 'IN_PROGRESS' };
let n = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = init.method ?? 'GET';
  const p = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
  calls.push({ method, path: `${u.host}${u.pathname}`, p });
  const json = (b) => new Response(JSON.stringify(b), { status: 200 });
  const sid = (prefix) => `${prefix}${++n}`;
  if (method === 'GET' && u.pathname.startsWith('/v1/CustomerProfiles/')) return json({ status: state.profile });
  if (method === 'GET' && u.pathname.startsWith('/v1/TrustProducts/')) return json({ status: state.trust });
  if (method === 'GET' && u.pathname.includes('/a2p/BrandRegistrations/')) return json({ status: state.brand });
  if (method === 'GET' && u.pathname.includes('/Compliance/Usa2p/')) return json({ campaign_status: state.campaign });
  if (u.pathname.endsWith('/CustomerProfiles')) return json({ sid: sid('BU') });
  if (u.pathname.endsWith('/TrustProducts')) return json({ sid: sid('BU') });
  if (u.pathname.endsWith('/EndUsers')) return json({ sid: sid('IT') });
  if (u.pathname.endsWith('/Addresses.json')) return json({ sid: sid('AD') });
  if (u.pathname.endsWith('/SupportingDocuments')) return json({ sid: sid('RD') });
  if (u.pathname.endsWith('/BrandRegistrations')) return json({ sid: 'BN1' });
  if (u.pathname === '/v1/Services') return json({ sid: 'MG9' });
  if (u.pathname.endsWith('/Compliance/Usa2p')) return json({ sid: 'QE1' });
  return json({ sid: sid('XX') });
};
Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_PRIMARY_PROFILE_SID: 'BUprimary', TWILIO_MESSAGING_SERVICE_SID: 'MGshared', ADMIN_API_SECRET: 'admin', CRON_SECRET: 'cron' });

const a2p = await import('../lib/a2p.js');
const { default: admin } = await import('../lib/handlers/admin.js');
const { default: cron } = await import('../api/cron/[job].js');

const CLIENT = { id: 'c1', slug: 'desert-air', business_name: 'Desert Air', active: true, twilio_number_sid: 'PN1', timezone: 'America/Los_Angeles', config: { owner_name: 'Mike' } };
const INFO = {
  legal_name: 'Desert Air LLC', ein: '12-3456789', business_type: 'Limited Liability Corporation', website: 'https://desertair.com',
  street: '1 Main St', city: 'Henderson', state: 'nv', zip: '89052',
  rep_first_name: 'Mike', rep_last_name: 'Jones', rep_email: 'mike@desertair.com', rep_phone: '702-555-0101', rep_title: 'Owner', rep_position: 'CEO',
};
const res = () => { const r = { statusCode: 200 }; r.status = (c) => (r.statusCode = c, r); r.json = (b) => (r.body = b, r); return r; };
const op = async (action, body = {}) => { const r = res();
  await admin({ method: 'POST', headers: { authorization: 'Bearer admin' }, query: { action }, body: { client_id: 'c1', ...body } }, r); return r; };

beforeEach(() => {
  db = createFakeDb({ clients: [structuredClone(CLIENT)] });
  calls.length = 0;
  Object.assign(state, { profile: 'pending-review', trust: 'pending-review', brand: 'PENDING', campaign: 'IN_PROGRESS' });
});

test('validation catches bad business info before any Twilio call', async () => {
  const r = await op('a2p-register', { info: { ...INFO, ein: '123', website: 'desertair.com' } });
  assert.equal(r.statusCode, 400);
  assert.match(r.body.error, /EIN must look like/);
  assert.match(r.body.error, /website must start/);
  assert.equal(calls.length, 0);
});

test('full path: profiles → brand → service + number + campaign → live', async () => {
  let r = await op('a2p-register', { info: INFO });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.a2p.status, 'profiles_pending');
  assert.equal(r.body.a2p.info.ein, '••-•••6789', 'EIN masked in the API');
  const biz = calls.find((c) => c.p.Type === 'customer_profile_business_information');
  assert.equal(JSON.parse(biz.p.Attributes).business_registration_number, '123456789');
  assert.ok(calls.some((c) => c.path.endsWith('/EntityAssignments') && c.p.ObjectSid === 'BUprimary'), 'primary profile assigned');
  assert.equal(calls.filter((c) => c.p.Status === 'pending-review').length, 2);

  r = await op('a2p-register', { info: INFO });
  assert.equal(r.statusCode, 409, 'no double registration');

  r = await op('a2p-status');
  assert.equal(r.body.a2p.status, 'profiles_pending', 'waits for approval');
  state.profile = 'twilio-approved'; state.trust = 'twilio-approved';
  r = await op('a2p-status');
  assert.equal(r.body.a2p.status, 'brand_pending');

  state.brand = 'APPROVED';
  r = await op('a2p-status');
  assert.equal(r.body.a2p.status, 'campaign_pending');
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/Services/MGshared/PhoneNumbers/PN1')), 'left the shared service');
  assert.ok(calls.some((c) => c.path.endsWith('/Services/MG9/PhoneNumbers') && c.p.PhoneNumberSid === 'PN1'));
  const camp = calls.find((c) => c.path.endsWith('/Compliance/Usa2p'));
  assert.equal(camp.p.UsAppToPersonUsecase, 'MIXED');
  assert.equal(camp.p.BrandRegistrationSid, 'BN1');
  assert.match(camp.p.MessageFlow, /reply STOP/i);

  state.campaign = 'VERIFIED';
  const c = await cron({ query: { job: 'a2p' }, headers: { authorization: 'Bearer cron' } }, res());
  assert.equal(db.tables.clients[0].a2p.status, 'live');
  assert.deepEqual(db.tables.clients[0].a2p.history.map((h) => h.status), ['profiles_pending', 'brand_pending', 'campaign_pending', 'live']);
});

test('rejections are recorded with a reason, and can be re-submitted', async () => {
  await op('a2p-register', { info: INFO });
  state.profile = 'twilio-rejected';
  const r = await op('a2p-status');
  assert.equal(r.body.a2p.status, 'rejected');
  assert.match(r.body.a2p.reason, /EIN must match the legal name/);
  const again = await op('a2p-register', { info: INFO });
  assert.equal(again.statusCode, 200);
});

test('campaign samples come from the real templates', () => {
  const c = a2p.campaignContent(CLIENT);
  assert.equal(c.MessageSamples.length, 4);
  assert.match(c.MessageSamples[0], /^Hi Sam, this is the team with Desert Air/);
});
