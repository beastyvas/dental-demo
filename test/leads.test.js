// Run with: node --test --experimental-test-module-mocks test/leads.test.js
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './fake-db.js';

let db = createFakeDb();
const proxy = { from: (table) => db.supabase.from(table) };
mock.module('../lib/supabase.js', {
  namedExports: { supabase: proxy, insertTolerant: (table, row) => proxy.from(table).insert([row]) },
});

const sent = [];
const vapiCalls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('api.twilio.com')) {
    const p = Object.fromEntries(new URLSearchParams(init.body));
    sent.push({ to: p.To, from: p.From, body: p.Body });
    return new Response(JSON.stringify({ sid: `SM${sent.length}`, status: 'queued' }), { status: 201 });
  }
  if (u === 'https://api.vapi.ai/call') { vapiCalls.push(JSON.parse(init.body)); return new Response('{"id":"call_out"}', { status: 201 }); }
  throw new Error(`unexpected fetch ${u}`);
};

Object.assign(process.env, {
  TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 'tok', VAPI_API_KEY: 'vk', VAPI_WEBHOOK_SECRET: 'shh',
  LEAD_EMAIL_SECRET: 'mail-secret', LEAD_EMAIL_DOMAIN: 'leads.example.com', DASHBOARD_URL: 'https://rx.example',
  JWT_SECRET: 'jwt',
});

const { parseLeadEmail, parseLeadAddress, leadEmailAddress, htmlToText } = await import('../lib/leadParse.js');
const { createLead, speedToLead } = await import('../lib/leads.js');
const { render, templateVars } = await import('../lib/automation.js');
const { default: leadsApi } = await import('../api/leads/[source].js');
const { handleEndOfCall } = await import('../api/vapi/events.js');
const { default: dashboard } = await import('../api/dashboard/[resource].js');
const { signToken } = await import('../lib/auth.js');

const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const CLIENT = {
  id: 'c1', slug: 'desert-air', business_name: 'Desert Air', agent_name: 'Riley', agent_id: 'asst_1', active: true,
  owner_phone: '+17025550101', twilio_number: '+17025559999', vapi_phone_number_id: 'pn_1',
  timezone: 'America/Los_Angeles', business_hours: null, lead_key: KEY, config: { owner_name: 'Mike' },
};

function res() {
  const r = { statusCode: 200, body: null, headers: {}, ended: false };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.end = () => { r.ended = true; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
}

beforeEach(() => {
  db = createFakeDb({ clients: [structuredClone(CLIENT)], client_leads: [], messages: [], opt_outs: [], calls: [], waitlist: [] });
  sent.length = 0;
  vapiCalls.length = 0;
});

// ── Parsing ───────────────────────────────────────────────────────────────

test('parses an Angi-style lead email by its labels', () => {
  const p = parseLeadEmail({
    from: 'Angi Leads <leads@angi.com>',
    subject: 'New Lead: Sarah Connor',
    text: 'You have a new lead!\nCustomer Name: Sarah Connor\nPhone: (702) 555-1234\nEmail: sarah@example.com\nProject Details: AC not cooling, 2-story home\nLocation: Henderson, NV\n\nCall Angi at 1-877-555-0000 for help.',
  });
  assert.equal(p.source, 'angi');
  assert.equal(p.name, 'Sarah Connor');
  assert.equal(p.phone, '+17025551234');
  assert.equal(p.email, 'sarah@example.com');
  assert.match(p.message, /AC not cooling/);
});

test('parses a Thumbtack-style HTML email with the name in the subject', () => {
  const p = parseLeadEmail({
    from: 'Thumbtack <no-reply@thumbtack.com>',
    subject: 'John Smith wants a quote for Roof Repair',
    html: '<table><tr><td>Phone</td><td>702.555.8888</td></tr><tr><td>Details</td><td>Leak over the garage&nbsp;after the storm</td></tr></table>',
  });
  assert.equal(p.source, 'thumbtack');
  assert.equal(p.name, 'John Smith');
  assert.equal(p.phone, '+17025558888');
  assert.match(p.message, /Leak over the garage after the storm/);
});

test('generic forwarded email: first phone that is not the business, no noreply emails', () => {
  const p = parseLeadEmail({
    from: 'mike@desertair.com',
    subject: 'Fwd: website inquiry',
    text: 'From: notifications@facebookmail.com\nSomeone wants work done. Our line 702-555-9999.\nTheir cell is 702 555 4321, email jo@example.org',
  }, { ignorePhones: ['+17025559999'] });
  assert.equal(p.source, 'meta');
  assert.equal(p.phone, '+17025554321');
  assert.equal(p.email, 'jo@example.org');
});

test('htmlToText keeps table cells as "label: value"', () => {
  assert.match(htmlToText('<tr><td>Name</td><td>Al</td></tr>'), /Name: Al/);
});

test('lead email addresses round-trip', () => {
  const addr = leadEmailAddress(CLIENT);
  assert.equal(addr, 'desert-air.a1b2c3d4e5@leads.example.com');
  assert.deepEqual(parseLeadAddress(`Leads <${addr}>`), { slug: 'desert-air', key: 'a1b2c3d4e5' });
  assert.equal(parseLeadAddress('random@leads.example.com'), null);
});

test('render tidies missing names', () => {
  assert.equal(render('Hi {first_name}, this is {agent}.', templateVars(CLIENT, {})), 'Hi there, this is Riley.');
  assert.equal(render('Hi {first_name}, got your request{about} — ok?', templateVars(CLIENT, { name: 'Sarah C', message: 'AC broken!' })),
    'Hi Sarah, got your request about AC broken — ok?');
});

// ── Lead inbox + speed-to-lead ───────────────────────────────────────────

test('createLead dedupes the same phone within 24h and fills gaps', async () => {
  const a = await createLead(CLIENT, { source: 'form', phone: '702-555-1234', message: 'AC' });
  const b = await createLead(CLIENT, { source: 'angi', phone: '(702) 555-1234', name: 'Sarah', email: 'S@x.com' });
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(db.tables.client_leads.length, 1);
  assert.equal(db.tables.client_leads[0].name, 'Sarah');
  assert.equal(db.tables.client_leads[0].email, 's@x.com');
  await assert.rejects(createLead(CLIENT, { source: 'form', name: 'No contact' }), /phone number or an email/);
});

test('speedToLead texts the lead from the AI line, alerts the owner, marks responded', async () => {
  const { lead } = await createLead(CLIENT, { source: 'form', name: 'Sarah Connor', phone: '7025551234', message: 'AC not cooling' });
  const out = await speedToLead(CLIENT, lead);
  assert.deepEqual([out.texted, out.called, out.ownerAlerted], [true, false, true]);
  assert.equal(sent[0].to, '+17025551234');
  assert.equal(sent[0].from, '+17025559999');
  assert.match(sent[0].body, /^Hi Sarah, this is Riley with Desert Air/);
  assert.equal(sent[1].to, '+17025550101');
  assert.match(sent[1].body, /New Website form lead/);
  assert.equal(db.tables.client_leads[0].status, 'contacted');
  assert.ok(db.tables.client_leads[0].first_response_at);
});

test('AI callback only when switched on and during business hours', async () => {
  const client = { ...CLIENT, automation: { speed_call: true } };
  const { lead } = await createLead(client, { source: 'form', phone: '7025551234' });
  // Tue 10am Las Vegas — open
  await speedToLead(client, lead, { now: new Date('2026-10-27T17:00:00Z') });
  assert.equal(vapiCalls.length, 1);
  assert.equal(vapiCalls[0].customer.number, '+17025551234');
  assert.match(vapiCalls[0].assistantOverrides.firstMessage, /AI assistant with Desert Air/);
  // Tue 11pm — closed
  await speedToLead(client, lead, { now: new Date('2026-10-28T06:00:00Z') });
  assert.equal(vapiCalls.length, 1);
  // Off by default
  await speedToLead(CLIENT, lead, { now: new Date('2026-10-27T17:00:00Z') });
  assert.equal(vapiCalls.length, 1);
});

test('opted-out leads are not texted but the owner still hears about it', async () => {
  db.tables.opt_outs.push({ client_id: 'c1', phone: '+17025551234' });
  const { lead } = await createLead(CLIENT, { source: 'form', phone: '7025551234' });
  const out = await speedToLead(CLIENT, lead);
  assert.equal(out.texted, false);
  assert.equal(out.ownerAlerted, true);
  assert.match(sent[0].body, /Reach out ASAP/);
});

// ── Webhooks ──────────────────────────────────────────────────────────────

test('website form: JSON post → lead + texts; wrong key 404; honeypot ignored', async () => {
  let r = res();
  await leadsApi({ method: 'POST', query: { source: 'form', key: KEY }, headers: { 'content-type': 'application/json' },
    body: { name: 'Al', phone: '702-555-2222', service: 'Roof leak', message: 'Water in the ceiling' } }, r);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(db.tables.client_leads[0].message, 'Roof leak — Water in the ceiling');
  assert.equal(sent.length, 2);

  r = res();
  await leadsApi({ method: 'POST', query: { source: 'form', key: 'nope-nope-nope' }, headers: {}, body: { phone: '7025552222' } }, r);
  assert.equal(r.statusCode, 404);

  r = res();
  await leadsApi({ method: 'POST', query: { source: 'form', key: KEY }, headers: { 'content-type': 'application/json' },
    body: { phone: '7025553333', company_website: 'spam.biz' } }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(db.tables.client_leads.length, 1, 'honeypot never saved');
});

test('website form: plain HTML post redirects or shows a thank-you page', async () => {
  let r = res();
  await leadsApi({ method: 'POST', query: { source: 'form', key: KEY }, headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: { phone: '7025554444', _redirect: 'https://desertair.com/thanks' } }, r);
  assert.equal(r.statusCode, 303);
  assert.equal(r.headers.Location, 'https://desertair.com/thanks');
  assert.ok(r.ended);

  r = res();
  await leadsApi({ method: 'POST', query: { source: 'form', key: KEY }, headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'phone=7025555555&_redirect=javascript:alert(1)' }, r);
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /Thanks — we got it/);
});

test('lead email webhook: secret + address key required; business numbers never texted', async () => {
  const mail = { to: 'desert-air.a1b2c3d4e5@leads.example.com', from: 'leads@angi.com', subject: 'New Lead: Pat',
    text: 'Name: Pat Lee\nPhone: 702-555-9999\nPhone: 702-555-7777\nDetails: furnace' };
  let r = res();
  await leadsApi({ method: 'POST', query: { source: 'email' }, headers: { 'x-lead-secret': 'wrong-secret' }, body: mail }, r);
  assert.equal(r.statusCode, 401);

  r = res();
  await leadsApi({ method: 'POST', query: { source: 'email' }, headers: { 'x-lead-secret': 'mail-secret' }, body: { ...mail, to: 'desert-air.zzzzzzzzzz@leads.example.com' } }, r);
  assert.equal(r.statusCode, 404);

  r = res();
  await leadsApi({ method: 'POST', query: { source: 'email' }, headers: { 'x-lead-secret': 'mail-secret' }, body: mail }, r);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  // Labeled phone is the AI line → falls back to the next number in the body.
  assert.equal(r.body.parsed.phone, '+17025557777');
  assert.equal(db.tables.client_leads[0].source, 'angi');
  assert.equal(sent[0].to, '+17025557777');
});

test('unreadable lead email alerts the owner instead', async () => {
  const r = res();
  await leadsApi({ method: 'POST', query: { source: 'email' }, headers: { 'x-lead-secret': 'mail-secret' },
    body: { to: 'desert-air.a1b2c3d4e5@leads.example.com', from: 'x@y.com', subject: 'Call me maybe', text: 'no contact info here' } }, r);
  assert.equal(r.body.skipped, 'no phone or email found');
  assert.equal(sent[0].to, '+17025550101');
  assert.match(sent[0].body, /Check your inbox/);
});

test('answered calls land in the inbox as responded', async () => {
  db.tables.waitlist.push({ id: 'w1', vapi_call_id: 'call_9', notes: 'BOOKED — Tue', patient_name: 'Jane' });
  await handleEndOfCall({
    type: 'end-of-call-report', endedReason: 'customer-ended-call',
    startedAt: '2026-10-19T17:00:00.000Z', endedAt: '2026-10-19T17:02:00.000Z',
    call: { id: 'call_9', assistantId: 'asst_1' }, customer: { number: '+17025556666' },
    analysis: { structuredData: { caller_name: 'Jane', need: 'AC tune-up' } }, artifact: { messages: [] },
  });
  const l = db.tables.client_leads[0];
  assert.equal(l.source, 'call');
  assert.equal(l.status, 'booked');
  assert.equal(l.message, 'AC tune-up');
  assert.equal(l.first_response_at, '2026-10-19T17:00:00.000Z');
});

test('dashboard: client sees their inbox + speed stats, can move a lead', async () => {
  await createLead(CLIENT, { source: 'form', phone: '7025551111', first_response_at: null });
  db.tables.client_leads[0].received_at = new Date(Date.now() - 90_000).toISOString();
  db.tables.client_leads[0].first_response_at = new Date(Date.now() - 60_000).toISOString();
  const token = signToken({ role: 'client', client_id: 'c1' });
  let r = res();
  await dashboard({ method: 'GET', query: { resource: 'leads' }, headers: { authorization: `Bearer ${token}` } }, r);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.leads.length, 1);
  assert.equal(r.body.stats.medianResponseSeconds, 30);
  assert.equal(r.body.stats.under5min, 1);

  r = res();
  await dashboard({ method: 'PATCH', query: { resource: 'leads' }, headers: { authorization: `Bearer ${token}` },
    body: { id: db.tables.client_leads[0].id, status: 'won' } }, r);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(db.tables.client_leads[0].status, 'won');

  r = res();
  await dashboard({ method: 'PATCH', query: { resource: 'leads' }, headers: { authorization: `Bearer ${token}` },
    body: { id: db.tables.client_leads[0].id, status: 'bogus' } }, r);
  assert.equal(r.statusCode, 400);
});
