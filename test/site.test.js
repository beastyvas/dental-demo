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

const { siteModel, renderSitePage, renderSitemap, renderRobots, DIRECTIONS } = await import('../lib/site.js');
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

test('defaults come from the trade template and service area — nothing invented', () => {
  const m = siteModel(CLIENT);
  assert.deepEqual(m.areas, ['Henderson', 'Las Vegas', 'North Las Vegas']);
  assert.equal(m.services[0].name, 'AC and heating repair');
  assert.equal(m.schemaType, 'HVACBusiness');
  assert.equal(m.headline, 'Heating & Air for Henderson');
  assert.equal(m.tagline, 'Calls answered day and night.');
  assert.equal(m.direction, 'jobsite');
  assert.deepEqual([m.license, m.rating, m.reviews.length, m.insured], [null, null, 0, false]);
});

test('pages are escaped, wired to the lead form, noindexed with a readiness note until published', () => {
  const html = renderSitePage(CLIENT, { base: 'https://rx.example/s/desert-air', formAction: '/api/leads/form?key=kkk' });
  assert.ok(html.includes('Desert Air &lt;HVAC&gt;'));
  assert.ok(!html.includes('<HVAC>'));
  assert.match(html, /<form method="POST" action="\/api\/leads\/form\?key=kkk">/);
  assert.match(html, /name="_redirect" value="https:\/\/rx.example\/s\/desert-air\?thanks=1#book"/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /Still needed: contractor license number \(Nevada law/);
  assert.match(html, /href="https:\/\/rx.example\/s\/desert-air\/north-las-vegas"/);
  assert.match(html, /"@type":"HVACBusiness"/);
  assert.match(html, /<nav class="bar"[^>]*><a class="call" href="tel:\+17025559999">Call \(702\) 555-9999<\/a><a class="est" href="#book">Free estimate<\/a>/);
  assert.match(renderSitemap(CLIENT, 'https://x.com'), /<loc>https:\/\/x.com\/las-vegas<\/loc>/);
  assert.match(renderRobots('https://x.com', false), /Disallow: \//);
});

const FULL = {
  ...CLIENT,
  site: {
    published: true, license: 'NV Lic. #0071234', license_limit: '$500,000', insured: true, rating: 4.9, review_count: 128,
    reviews: [{ name: 'Maria G.', text: 'Texted back in a minute.' }], reviews_url: 'https://g.page/r/abc',
    projects: [{ before: 'https://img.example/b1.jpg', after: 'https://img.example/a1.jpg', caption: 'Tile re-lay, Henderson' }],
    booking_url: 'https://cal.com/desert-air/estimate', color: '#0E4D64',
  },
};

test('license shows in the header and footer, rating/booking/before-after render from real data', () => {
  const html = renderSitePage(FULL, { base: 'https://desertair.com', formAction: '/f', area: 'Henderson', thanks: true });
  assert.ok(!html.includes('noindex'));
  assert.ok(!html.includes('Preview, not public yet'));
  assert.match(html, /<h1>Heating &amp; Air in Henderson<\/h1>/);
  assert.match(html, /class="lic">NV Lic. #0071234</);
  assert.match(html, /<p>NV Lic. #0071234, monetary limit \$500,000<\/p>/);
  assert.match(html, /4\.9 stars from 128 Google reviews/);
  assert.match(html, /<iframe class="embed" src="https:\/\/cal.com\/desert-air\/estimate"/);
  assert.match(html, /class="ba-before" src="https:\/\/img.example\/b1.jpg"/);
  assert.match(html, /aria-label="Drag to compare before and after, project 1"/);
  assert.match(html, /"aggregateRating"/);
  assert.match(html, /Got it, thanks/);
  // Only known schedulers get embedded.
  const evil = renderSitePage({ ...FULL, site: { ...FULL.site, booking_url: 'https://evil.example/x' } }, { base: 'https://x', formAction: '/f' });
  assert.ok(!evil.includes('<iframe'));
});

test('ban list: no AI-default looks in any direction (docs/site-playbook.md)', () => {
  for (const direction of Object.keys(DIRECTIONS)) {
    const html = renderSitePage({ ...FULL, site: { ...FULL.site, direction } }, { base: 'https://x.com', formAction: '/f' });
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    for (const font of ['Inter', 'Roboto', 'Arial', 'Open Sans', 'Lato', 'Space Grotesk', 'system-ui', '-apple-system', 'Segoe UI']) {
      assert.ok(!html.includes(font), `${direction}: banned font ${font}`);
    }
    assert.ok(!/gradient\(/.test(css), `${direction}: gradient`);
    assert.ok(!/border-radius:\s*(999|[3-9]\d)px|border-radius:\s*50%/.test(css), `${direction}: pill/round shapes`);
    assert.ok(!/text-transform:\s*uppercase/.test(css), `${direction}: all-caps labels`);
    assert.ok(!/monospace/.test(css), `${direction}: monospace`);
    assert.ok(!/font-style:\s*italic|<em>|<i>/.test(html), `${direction}: italic accents`);
    assert.ok(!/[·→]/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), `${direction}: middle dots or arrows`);
    assert.ok(!/\b0[1-9]\b\s*[\/<]/.test(html), `${direction}: 01/02 markers`);
    const text = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ');
    assert.ok(!/\b(Submit|elevate|seamless|trusted partner|solutions)\b/i.test(text), `${direction}: cliché copy`);
    assert.ok(!/@keyframes|transition:|:hover\s*\{[^}]*transform/.test(css), `${direction}: decorative motion`);
    assert.ok(!/#F4F1EA|#D97757/i.test(html), `${direction}: cream / Claude terracotta`);
  }
});

test('served by slug (preview) and by custom domain; unknown area 404s', async () => {
  let r = res();
  await site({ query: { slug: 'desert-air' } }, r);
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /<title>Desert Air &lt;HVAC&gt; \| Heating &amp; Air in Henderson<\/title>/);
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
