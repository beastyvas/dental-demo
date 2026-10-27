/**
 * Client websites, rendered server-side from clients.site (+ the onboarding
 * config and the trade template), so a business gets a fast, indexable site
 * with a quote form wired straight into speed-to-lead.
 *
 *   siteModel(client)                      → the merged content (defaults filled in)
 *   renderSitePage(client, { area, base, thanks })
 *   renderSitemap(client, base) / renderRobots(base)
 */

import { loadTrade, TRADES } from './prompt.js';
import { describeHours } from './businessHours.js';
import { prettyPhone } from './phone.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const slugifyArea = (a) => String(a).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const SCHEMA_TYPE = { hvac: 'HVACBusiness', roofing: 'RoofingContractor', remodel: 'GeneralContractor', 'emergency-trade': 'HomeAndConstructionBusiness' };
const TRADE_NOUN = { hvac: 'Heating & Air', roofing: 'Roofing', remodel: 'Remodeling', 'emergency-trade': 'Home Services' };

function splitAreas(serviceArea) {
  return String(serviceArea ?? '')
    .replace(/\band the surrounding area\b|\bsurrounding areas?\b/gi, '')
    .split(/,|\band\b|&/).map((s) => s.trim()).filter((s) => s.length > 1).slice(0, 12);
}

/** Owner-written content wins; everything else comes from what we already know. */
export function siteModel(client) {
  const site = client.site ?? {};
  const cfg = client.config ?? {};
  const trade = TRADES.includes(client.trade ?? cfg.trade) ? (client.trade ?? cfg.trade) : null;
  const t = trade ? loadTrade(trade) : null;
  const areas = site.areas?.length ? site.areas : splitAreas(client.service_area ?? cfg.service_area);
  const city = areas[0] || 'your area';
  const services = site.services?.length ? site.services
    : (t?.services ?? []).map((s) => { const [name, blurb] = s.split(/\s+—\s+/); return { name, blurb: blurb ?? '' }; });
  return {
    name: client.business_name,
    trade,
    tradeNoun: TRADE_NOUN[trade] ?? 'Home Services',
    schemaType: SCHEMA_TYPE[trade] ?? 'HomeAndConstructionBusiness',
    headline: site.headline || `${TRADE_NOUN[trade] ?? 'Service'} in ${city} — we pick up, 24/7`,
    subhead: site.subhead || `Call or text anytime. Real answers, fast scheduling, honest pricing from ${client.business_name}.`,
    about: site.about || (cfg.business_facts ?? []).join(' '),
    facts: cfg.business_facts ?? [],
    services,
    areas,
    reviews: site.reviews ?? [],
    photos: (site.photos ?? []).filter((u) => /^https:\/\//.test(u)),
    color: /^#[0-9a-f]{6}$/i.test(site.color ?? '') ? site.color : '#1d4ed8',
    phone: client.twilio_number,
    hours: describeHours(client.business_hours ?? cfg.business_hours ?? null),
    license: site.license ?? null,
    published: Boolean(site.published),
    domain: site.domain ?? null,
  };
}

const pageUrl = (base, area) => `${base}${area ? `/${slugifyArea(area)}` : ''}`;

export function renderSitePage(client, { area = null, base, formAction, thanks = false }) {
  const m = siteModel(client);
  const where = area ?? m.areas[0] ?? '';
  const title = area ? `${m.tradeNoun} in ${area} | ${m.name}` : `${m.name} — ${m.tradeNoun}${where ? ` in ${where}` : ''}`;
  const h1 = area ? `${m.tradeNoun} in ${area}` : m.headline;
  const desc = `${m.name}: ${m.services.slice(0, 3).map((s) => s.name).join(', ')}${where ? ` in ${where}` : ''}. Call or text ${prettyPhone(m.phone)} — answered 24/7.`;
  const tel = m.phone ? `tel:${m.phone}` : null;
  const self = pageUrl(base, area);
  const jsonLd = {
    '@context': 'https://schema.org', '@type': m.schemaType, name: m.name, url: base,
    ...(m.phone ? { telephone: m.phone } : {}),
    ...(m.areas.length ? { areaServed: m.areas.map((a) => ({ '@type': 'City', name: a })) } : {}),
    ...(m.photos[0] ? { image: m.photos[0] } : {}),
  };
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(self)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
${m.photos[0] ? `<meta property="og:image" content="${esc(m.photos[0])}">` : ''}
${m.published ? '' : '<meta name="robots" content="noindex">'}
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
<style>
:root{--c:${m.color};--ink:#111827;--muted:#4b5563;--bg:#fff;--soft:#f3f4f6}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--bg);line-height:1.55}
a{color:var(--c)}.wrap{max-width:1040px;margin:0 auto;padding:0 20px}
header{border-bottom:1px solid #e5e7eb}header .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:14px;padding-bottom:14px}
.brand{font-weight:800;font-size:18px;color:var(--ink);text-decoration:none}.call{background:var(--c);color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:700;white-space:nowrap}
.hero{background:var(--soft)}.hero .wrap{display:grid;gap:28px;padding-top:44px;padding-bottom:44px}@media(min-width:860px){.hero .wrap{grid-template-columns:1.2fr 1fr;align-items:start}}
h1{font-size:clamp(28px,5vw,44px);line-height:1.1;margin:0 0 12px}.sub{color:var(--muted);font-size:18px;margin:0 0 20px}
form{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:20px;display:grid;gap:10px}form h2{margin:0 0 4px;font-size:20px}
input,textarea{width:100%;font:inherit;padding:11px 12px;border:1px solid #d1d5db;border-radius:9px}textarea{min-height:90px}
button{background:var(--c);color:#fff;border:0;border-radius:10px;padding:12px;font:inherit;font-weight:700;cursor:pointer}
.fine{font-size:12px;color:var(--muted)}.hp{position:absolute;left:-9999px}
section{padding:40px 0}h2{font-size:26px;margin:0 0 16px}.grid{display:grid;gap:14px}@media(min-width:700px){.grid{grid-template-columns:repeat(3,1fr)}}
.card{border:1px solid #e5e7eb;border-radius:12px;padding:16px}.card h3{margin:0 0 6px;font-size:17px}.card p{margin:0;color:var(--muted)}
.areas{display:flex;flex-wrap:wrap;gap:8px;padding:0;list-style:none}.areas a{display:block;padding:6px 12px;border:1px solid #e5e7eb;border-radius:999px;text-decoration:none;color:var(--ink)}
.photos{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}.photos img{width:100%;height:180px;object-fit:cover;border-radius:10px}
blockquote{margin:0}.thanks{background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:14px;margin-bottom:12px}
footer{border-top:1px solid #e5e7eb;color:var(--muted);font-size:14px}footer .wrap{padding-top:24px;padding-bottom:40px}
</style></head>
<body>
<header><div class="wrap"><a class="brand" href="${esc(base)}">${esc(m.name)}</a>${tel ? `<a class="call" href="${esc(tel)}">Call ${esc(prettyPhone(m.phone))}</a>` : ''}</div></header>
<div class="hero"><div class="wrap">
  <div><h1>${esc(h1)}</h1><p class="sub">${esc(m.subhead)}</p>
  ${tel ? `<p><a class="call" href="${esc(tel)}">Call or text ${esc(prettyPhone(m.phone))}</a></p>` : ''}
  ${m.hours ? `<p class="fine">Office hours: ${esc(m.hours)}. Calls answered 24/7.</p>` : ''}</div>
  <form method="POST" action="${esc(formAction)}">
    ${thanks ? '<div class="thanks"><strong>Thanks — we got it.</strong> Check your phone for a text from us.</div>' : ''}
    <h2>Get a free quote</h2>
    <input name="name" placeholder="Your name" autocomplete="name" required>
    <input name="phone" type="tel" placeholder="Phone" autocomplete="tel" required>
    <input name="email" type="email" placeholder="Email (optional)" autocomplete="email">
    <textarea name="message" placeholder="What do you need help with?"></textarea>
    <input class="hp" name="company_website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <input type="hidden" name="_redirect" value="${esc(`${self}?thanks=1`)}">
    <button type="submit">Send — we'll text you back fast</button>
    <p class="fine">By sending, you agree we can call or text you about your request. Reply STOP anytime.</p>
  </form>
</div></div>
${m.services.length ? `<section><div class="wrap"><h2>What we do</h2><div class="grid">${m.services.map((s) => `<div class="card"><h3>${esc(s.name)}</h3>${s.blurb ? `<p>${esc(s.blurb)}</p>` : ''}</div>`).join('')}</div></div></section>` : ''}
${m.about || m.facts.length ? `<section style="background:var(--soft)"><div class="wrap"><h2>About ${esc(m.name)}</h2>${m.about ? `<p>${esc(m.about)}</p>` : ''}</div></section>` : ''}
${m.photos.length ? `<section><div class="wrap"><h2>Our work</h2><div class="photos">${m.photos.map((u) => `<img src="${esc(u)}" alt="${esc(m.name)} project" loading="lazy">`).join('')}</div></div></section>` : ''}
${m.reviews.length ? `<section><div class="wrap"><h2>What customers say</h2><div class="grid">${m.reviews.slice(0, 6).map((r) => `<blockquote class="card"><p>“${esc(r.text)}”</p><h3 style="margin-top:8px">${esc(r.name ?? '')}</h3></blockquote>`).join('')}</div></div></section>` : ''}
${m.areas.length ? `<section><div class="wrap"><h2>Areas we serve</h2><ul class="areas">${m.areas.map((a) => `<li><a href="${esc(pageUrl(base, a))}">${esc(a)}</a></li>`).join('')}</ul></div></section>` : ''}
<footer><div class="wrap">© ${new Date().getFullYear()} ${esc(m.name)}${m.license ? ` · ${esc(m.license)}` : ''}${tel ? ` · <a href="${esc(tel)}">${esc(prettyPhone(m.phone))}</a>` : ''}</div></footer>
</body></html>`;
}

export function renderSitemap(client, base) {
  const m = siteModel(client);
  const urls = [base, ...m.areas.map((a) => pageUrl(base, a))];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
}

export const renderRobots = (base, published) =>
  published ? `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n';
