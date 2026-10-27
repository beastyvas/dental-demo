// Run with: node --test --experimental-test-module-mocks test/site.test.js
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './fake-db.js';

let db = createFakeDb();
const proxy = { from: (table) => db.supabase.from(table) };
mock.module('../lib/supabase.js', { namedExports: { supabase: proxy, insertTolerant: () => ({}) } });

const vercelCalls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.host === 'api.vercel.com') {
    vercelCalls.push(`${init.method ?? 'GET'} ${u.pathname}${u.search}`);
    if (u.pathname.includes('/config')) return new Response(JSON.stringify({ misconfigured: true }), { status: 200 });
    return new Response(JSON.stringify({ name: JSON.parse(init.body).name, verified: true }), { status: 200 });
  }
  throw new Error(`unexpected fetch ${url}`);
};
Object.assign(process.env, {
  DASHBOARD_URL: 'https://rx.example', ADMIN_API_SECRET: 'admin',
  VERCEL_TOKEN: 'vt', VERCEL_PROJECT_ID: 'prj_1', VERCEL_TEAM_ID: 'team_1',
});

const { siteModel, renderSitePage, renderSitemap, renderRobots } = await import('../lib/site.js');
const { default: site } = await import('../api/site.js');
const { default: admin } = await import('../lib/handlers/admin.js');
const { default: middleware } = await import('../middleware.js');

const CLIENT = {
  id: 'c1', slug: 'desert-air', business_name: 'Desert Air <HVAC>', active: true, trade: 'hvac', lead_key: 'k'.repeat(32),
  twilio_number: '+17025559999', service_area: 'Henderson, Las Vegas and North Las Vegas', timezone: 'America/Los_Angeles',
  config: { business_facts: ['Family-owned since 2011'] }, site: null,
};
const res = () => { const r = { statusCode: 200, headers: {} }; r.status = (c) => (r.statusCode = c, r); r.json = (b) => (r.body = b, r);
  r.send = (b) => (r.body = b, r); r.setHeader = (k, v) => (r.headers[k] = v, r); return r; };

beforeEach(() => {
  db = createFakeDb({ clients: [structuredClone(CLIENT), { id: 'c2', slug: 'other', business_name: 'Other', active: true, site: { domain: 'taken.com' } }] });
  vercelCalls.length = 0;
});

test('defaults come from the trade template and service area', () => {
  const m = siteModel(CLIENT);
  assert.deepEqual(m.areas, ['Henderson', 'Las Vegas', 'North Las Vegas']);
  assert.equal(m.services[0].name, 'AC and heating repair');
  assert.equal(m.schemaType, 'HVACBusiness');
  assert.match(m.headline, /^Heating & Air in Henderson/);
  assert.equal(m.published, false);
});

test('pages are escaped, wired to the lead form, noindexed until published', () => {
  const html = renderSitePage(CLIENT, { base: 'https://rx.example/s/desert-air', formAction: '/api/leads/form?key=kkk' });
  assert.ok(html.includes('Desert Air &lt;HVAC&gt;'));
  assert.ok(!html.includes('<HVAC>'));
  assert.match(html, /<form method="POST" action="\/api\/leads\/form\?key=kkk">/);
  assert.match(html, /name="_redirect" value="https:\/\/rx.example\/s\/desert-air\?thanks=1"/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /href="https:\/\/rx.example\/s\/desert-air\/north-las-vegas"/);
  assert.match(html, /"@type":"HVACBusiness"/);
  const pub = renderSitePage({ ...CLIENT, site: { published: true } }, { base: 'https://x.com', formAction: '#', area: 'Henderson', thanks: true });
  assert.ok(!pub.includes('noindex'));
  assert.match(pub, /<h1>Heating &amp; Air in Henderson<\/h1>/);
  assert.match(pub, /Thanks — we got it/);
  assert.match(renderSitemap(CLIENT, 'https://x.com'), /<loc>https:\/\/x.com\/las-vegas<\/loc>/);
  assert.match(renderRobots('https://x.com', false), /Disallow: \//);
});

test('served by slug (preview) and by custom domain; unknown area 404s', async () => {
  let r = res();
  await site({ query: { slug: 'desert-air' } }, r);
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /<title>Desert Air &lt;HVAC&gt; — Heating &amp; Air in Henderson<\/title>/);
  r = res();
  await site({ query: { slug: 'desert-air', area: 'mars' } }, r);
  assert.equal(r.statusCode, 404);

  db.tables.clients[0].site = { domain: 'desertair.com', published: true };
  r = res();
  await site({ query: { host: 'www.desertair.com', path: '/henderson' } }, r);
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /<link rel="canonical" href="https:\/\/desertair.com\/henderson">/);
  r = res();
  await site({ query: { host: 'desertair.com', path: '/sitemap.xml' } }, r);
  assert.equal(r.headers['Content-Type'], 'application/xml');
  r = res();
  await site({ query: { host: 'nobody.com', path: '/' } }, r);
  assert.equal(r.statusCode, 404);
});

test('middleware: our hosts pass through, customer domains render their site', () => {
  const h = (u) => Object.fromEntries(middleware(new Request(u)).headers);
  assert.deepEqual(h('https://rx.example/'), { 'x-middleware-next': '1' });
  assert.deepEqual(h('https://preview-abc.vercel.app/'), { 'x-middleware-next': '1' });
  assert.equal(h('https://desertair.com/las-vegas')['x-middleware-rewrite'], 'https://desertair.com/api/site?host=desertair.com&path=%2Flas-vegas');
});

test('connecting a domain adds apex + www on Vercel and returns the DNS to set', async () => {
  const call = async (action, body) => { const r = res();
    await admin({ method: 'POST', headers: { authorization: 'Bearer admin' }, query: { action }, body: { client_id: 'c1', ...body } }, r); return r; };
  let r = await call('domain-connect', { domain: 'https://www.DesertAir.com/' });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.domain, 'desertair.com');
  assert.deepEqual(r.body.dns.map((d) => `${d.type} ${d.name} ${d.value}`), ['A @ 76.76.21.21', 'CNAME www cname.vercel-dns.com']);
  assert.ok(vercelCalls.includes('POST /v10/projects/prj_1/domains?teamId=team_1'));
  assert.equal(db.tables.clients[0].site.domain, 'desertair.com');
  assert.equal(r.body.status.configured, false);

  r = await call('domain-connect', { domain: 'taken.com' });
  assert.equal(r.statusCode, 409);
  r = await call('domain-connect', { domain: 'not a domain' });
  assert.equal(r.statusCode, 400);
});
