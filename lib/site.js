/**
 * Client websites, rendered server-side from clients.site (+ the onboarding
 * config and the trade template): fast, indexable, and wired into
 * speed-to-lead. Design rules: .claude/skills/trade-site/SKILL.md and
 * docs/site-playbook.md — every client picks a design direction, the only
 * "big" moment is the before/after slider, and nothing on the ban list.
 *
 *   siteModel(client)                      → the merged content (defaults filled in)
 *   readiness(client)                      → what's missing before publishing
 *   renderSitePage(client, { area, base, formAction, thanks })
 *   renderSitemap(client, base) / renderRobots(base, published)
 */

import { loadTrade, TRADES } from './prompt.js';
import { describeHours } from './businessHours.js';
import { prettyPhone } from './phone.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const slugifyArea = (a) => String(a).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const SCHEMA_TYPE = { hvac: 'HVACBusiness', roofing: 'RoofingContractor', remodel: 'GeneralContractor', 'emergency-trade': 'HomeAndConstructionBusiness' };
const TRADE_NOUN = { hvac: 'Heating & Air', roofing: 'Roofing', remodel: 'Remodeling', 'emergency-trade': 'Home Repair' };

// Booking embeds we'll put in an iframe — the client's own scheduler.
const BOOKING_HOSTS = /(^|\.)(getjobber\.com|jobber\.com|housecallpro\.com|cal\.com|calendar\.google\.com|calendly\.com)$/i;

/**
 * Design directions — distinct type + feel; the client's brand color is the
 * dominant color, the direction supplies the accent and the rest. Fonts are
 * from Google Fonts and none is on the ban list.
 */
export const DIRECTIONS = {
  jobsite: {
    label: 'Jobsite — wide, heavy type, safety-yellow actions, square edges',
    fonts: 'family=Archivo:wdth,wght@112..125,300..900&family=Public+Sans:wght@300;400;600',
    display: "'Archivo', sans-serif", displayStretch: '125%', displayWeight: 900,
    body: "'Public Sans', sans-serif",
    bg: '#ECEEF0', surface: '#FFFFFF', ink: '#14181D', muted: '#4A525C', line: '#C9CED4',
    accent: '#FFC20E', accentInk: '#14181D', radius: '2px',
  },
  mojave: {
    label: 'Mojave — sun-bleached concrete, condensed headlines, burnt-orange actions',
    fonts: 'family=Barlow+Condensed:wght@300;700;800&family=Source+Sans+3:wght@300;400;600',
    display: "'Barlow Condensed', sans-serif", displayStretch: '100%', displayWeight: 800,
    body: "'Source Sans 3', sans-serif",
    bg: '#E4E1DC', surface: '#F7F6F4', ink: '#22201D', muted: '#5C5751', line: '#C8C3BB',
    accent: '#E8590C', accentInk: '#FFFFFF', radius: '4px',
  },
  steel: {
    label: 'Steel — charcoal and white bands, tall condensed type, bright-blue actions',
    fonts: 'family=Saira+Condensed:wght@300;700;800&family=IBM+Plex+Sans:wght@300;400;600',
    display: "'Saira Condensed', sans-serif", displayStretch: '100%', displayWeight: 800,
    body: "'IBM Plex Sans', sans-serif",
    bg: '#F3F4F5', surface: '#FFFFFF', ink: '#1B1F24', muted: '#525A64', line: '#D3D7DC',
    accent: '#0A84FF', accentInk: '#FFFFFF', radius: '3px',
  },
};
export const DEFAULT_DIRECTION = 'jobsite';

/** Pick white or ink text for a background color (WCAG relative luminance). */
function textOn(hex, ink) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.45 ? ink : '#FFFFFF';
}

function splitAreas(serviceArea) {
  return String(serviceArea ?? '')
    .replace(/\band the surrounding area\b|\bsurrounding areas?\b/gi, '')
    .split(/,|\band\b|&/).map((s) => s.trim()).filter((s) => s.length > 1).slice(0, 12);
}

const safeUrl = (u) => (/^https:\/\//.test(String(u ?? '')) ? String(u) : null);
const bookingUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && BOOKING_HOSTS.test(x.hostname) ? x.toString() : null; } catch { return null; } };

/** Owner-written content wins; everything else comes from what we already know. Nothing invented. */
export function siteModel(client) {
  const site = client.site ?? {};
  const cfg = client.config ?? {};
  const trade = TRADES.includes(client.trade ?? cfg.trade) ? (client.trade ?? cfg.trade) : null;
  const t = trade ? loadTrade(trade) : null;
  const areas = site.areas?.length ? site.areas : splitAreas(client.service_area ?? cfg.service_area);
  const noun = TRADE_NOUN[trade] ?? 'Home Repair';
  const services = site.services?.length ? site.services
    : (t?.services ?? []).map((s) => { const [name, blurb] = s.split(/\s+—\s+/); return { name, blurb: blurb ?? '' }; });
  const direction = DIRECTIONS[site.direction] ? site.direction : DEFAULT_DIRECTION;
  return {
    name: client.business_name,
    trade,
    tradeNoun: noun,
    schemaType: SCHEMA_TYPE[trade] ?? 'HomeAndConstructionBusiness',
    direction,
    headline: site.headline || `${noun} for ${areas[0] ?? 'your home'}`,
    tagline: site.tagline ?? 'Calls answered day and night.',
    subhead: site.subhead || (areas.length > 1 ? `Serving ${areas.slice(0, -1).join(', ')} and ${areas.at(-1)}.` : ''),
    about: site.about || (cfg.business_facts ?? []).join(' '),
    services,
    areas,
    reviews: (site.reviews ?? []).filter((r) => r?.text),
    rating: Number(site.rating) > 0 ? Number(site.rating) : null,
    reviewCount: Number(site.review_count) > 0 ? Number(site.review_count) : null,
    reviewsUrl: safeUrl(site.reviews_url ?? client.google_review_link),
    projects: (site.projects ?? []).filter((p) => safeUrl(p?.before) && safeUrl(p?.after)),
    photos: (site.photos ?? []).filter((u) => safeUrl(u)),
    color: /^#[0-9a-f]{6}$/i.test(site.color ?? '') ? site.color : '#1F3A5F',
    phone: client.twilio_number,
    hours: describeHours(client.business_hours ?? cfg.business_hours ?? null),
    license: String(site.license ?? '').trim() || null,
    licenseLimit: String(site.license_limit ?? '').trim() || null,
    insured: Boolean(site.insured),
    booking: bookingUrl(site.booking_url),
    published: Boolean(site.published),
    domain: site.domain ?? null,
  };
}

/** What's missing before this site should go public. license is required by law (NRS 624.720). */
export function readiness(client) {
  const m = siteModel(client);
  const missing = [];
  if (!m.license) missing.push('contractor license number (Nevada law — required on every page)');
  if (!m.phone) missing.push('AI line phone number');
  if (!m.projects.length && !m.photos.length) missing.push('real job photos (before/after pairs are best)');
  if (!m.reviews.length && !m.rating) missing.push('real reviews or their Google rating');
  if (!m.booking) missing.push('booking link (optional — the form works without it)');
  return { canPublish: Boolean(m.license && m.phone), missing };
}

const pageUrl = (base, area) => `${base}${area ? `/${slugifyArea(area)}` : ''}`;

function beforeAfter(p, i, name) {
  // The one memorable moment: drag to reveal the after shot. Works without JS
  // (shows the after photo); the range input is keyboard-accessible.
  return `<figure class="ba">
  <div class="ba-frame" style="--pos:50%">
    <img src="${esc(p.after)}" alt="${esc(`${name} — after${p.caption ? `: ${p.caption}` : ''}`)}" loading="lazy" width="1200" height="800">
    <img class="ba-before" src="${esc(p.before)}" alt="${esc(`${name} — before${p.caption ? `: ${p.caption}` : ''}`)}" loading="lazy" width="1200" height="800">
    <span class="ba-tag ba-tag-l">Before</span><span class="ba-tag ba-tag-r">After</span>
    <input class="ba-range" type="range" min="0" max="100" value="50" aria-label="Drag to compare before and after, project ${i + 1}">
  </div>
  ${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}
</figure>`;
}

export function renderSitePage(client, { area = null, base, formAction, thanks = false }) {
  const m = siteModel(client);
  const d = DIRECTIONS[m.direction];
  const ready = readiness(client);
  const brandText = textOn(m.color, d.ink);
  const where = area ?? m.areas[0] ?? '';
  const title = area ? `${m.tradeNoun} in ${area} | ${m.name}` : `${m.name} | ${m.tradeNoun}${where ? ` in ${where}` : ''}`;
  const h1 = area ? `${m.tradeNoun} in ${area}` : m.headline;
  const desc = `${m.name}: ${m.services.slice(0, 3).map((s) => s.name).join(', ')}${where ? ` in ${where}` : ''}. Call or text ${prettyPhone(m.phone)} anytime.${m.license ? ` ${m.license}.` : ''}`;
  const tel = m.phone ? `tel:${m.phone}` : null;
  const phone = prettyPhone(m.phone);
  const self = pageUrl(base, area);
  const [lead, ...rest] = m.services;
  const jsonLd = {
    '@context': 'https://schema.org', '@type': m.schemaType, name: m.name, url: base,
    ...(m.phone ? { telephone: m.phone } : {}),
    ...(m.areas.length ? { areaServed: m.areas.map((a) => ({ '@type': 'City', name: a })) } : {}),
    ...(m.projects[0] ? { image: m.projects[0].after } : m.photos[0] ? { image: m.photos[0] } : {}),
    ...(m.rating && m.reviewCount ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: m.rating, reviewCount: m.reviewCount } } : {}),
  };
  // The license is already in the header (and footer); don't repeat it here.
  const trustLine = [m.insured ? 'Licensed, bonded and insured' : null].filter(Boolean);

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(self)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
${m.projects[0] ? `<meta property="og:image" content="${esc(m.projects[0].after)}">` : m.photos[0] ? `<meta property="og:image" content="${esc(m.photos[0])}">` : ''}
${m.published ? '' : '<meta name="robots" content="noindex">'}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${d.fonts}&display=swap" rel="stylesheet">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
<style>
:root{--brand:${m.color};--on-brand:${brandText};--accent:${d.accent};--on-accent:${d.accentInk};--bg:${d.bg};--surface:${d.surface};--ink:${d.ink};--muted:${d.muted};--line:${d.line};--r:${d.radius};
--display:${d.display};--body:${d.body}}
*{box-sizing:border-box}html{scroll-behavior:smooth}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
body{margin:0;font-family:var(--body);font-weight:400;font-size:17px;color:var(--ink);background:var(--bg);line-height:1.6}
a{color:inherit}.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
h1,h2,h3,.name{font-family:var(--display);font-stretch:${d.displayStretch};font-weight:${d.displayWeight};line-height:1.02;letter-spacing:-.01em;margin:0}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.btn{display:inline-block;background:var(--accent);color:var(--on-accent);font-weight:600;text-decoration:none;padding:14px 22px;border-radius:var(--r);border:0;font:inherit;font-weight:600;cursor:pointer}
.top{background:var(--brand);color:var(--on-brand)}.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:14px;padding-bottom:14px}
.top .name{font-size:22px;text-decoration:none}.lic{font-size:13px;opacity:.85;margin-top:4px}
.top-call{font-weight:600;text-decoration:none;white-space:nowrap}@media(max-width:640px){.top-call{display:none}}
.hero{background:var(--brand);color:var(--on-brand);padding:48px 0 64px}
.hero .wrap{display:grid;gap:36px}@media(min-width:900px){.hero .wrap{grid-template-columns:1.25fr 1fr;align-items:end}}
.hero h1{font-size:clamp(44px,7vw,80px);max-width:12ch}.hero .tag{font-family:var(--display);font-stretch:${d.displayStretch};font-weight:300;font-size:clamp(22px,2.6vw,30px);margin:14px 0 0}.hero .sub{font-size:19px;font-weight:300;margin:20px 0 0;max-width:34ch;opacity:.92}
.hero-actions{display:flex;flex-wrap:wrap;align-items:center;gap:20px;margin-top:28px}.hero-actions .tel{font-weight:600;font-size:19px}
.trust{margin-top:22px;font-size:14px;opacity:.88}.trust p{margin:2px 0}
.hero-shot{width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r);display:block}
.ready{background:#FFF4CC;color:#3D3000;font-size:14px;padding:10px 20px}
section{padding:72px 0}.band{background:var(--surface)}
h2{font-size:clamp(34px,5vw,56px);margin-bottom:28px}
.svc-lead h3{font-size:clamp(28px,4vw,40px)}.svc-lead p{font-size:19px;font-weight:300;color:var(--muted);max-width:52ch;margin:10px 0 0}
.svc-rest{display:grid;gap:22px 48px;margin-top:40px}@media(min-width:760px){.svc-rest{grid-template-columns:1fr 1fr}}
.svc-rest h3{font-family:var(--body);font-stretch:100%;font-weight:600;font-size:20px;line-height:1.3;letter-spacing:0}.svc-rest p{margin:6px 0 0;color:var(--muted)}
.proof{display:grid;gap:28px}@media(min-width:900px){.proof{grid-template-columns:1fr 1fr}}
.ba{margin:0}.ba-frame{position:relative;overflow:hidden;border-radius:var(--r);aspect-ratio:3/2;background:var(--line)}
.ba-frame img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ba-before{clip-path:inset(0 calc(100% - var(--pos)) 0 0)}
.ba-frame::after{content:"";position:absolute;top:0;bottom:0;left:var(--pos);width:3px;margin-left:-1px;background:var(--accent);pointer-events:none}
.ba-range{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:ew-resize;margin:0}
.ba-tag{position:absolute;bottom:10px;background:rgba(0,0,0,.6);color:#fff;font-size:13px;padding:3px 8px;border-radius:var(--r)}.ba-tag-l{left:10px}.ba-tag-r{right:10px}
.ba figcaption{font-size:15px;color:var(--muted);margin-top:8px}
.photos{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}.photos img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r)}
.reviews{display:grid;gap:36px}@media(min-width:900px){.reviews{grid-template-columns:repeat(2,1fr)}}
.reviews blockquote{margin:0;font-size:20px;font-weight:300;line-height:1.45}.reviews cite{display:block;font-style:normal;font-weight:600;font-size:15px;margin-top:10px}
.rating{font-size:18px;margin:-12px 0 28px}
.areas p{font-size:19px;max-width:60ch}.areas a{font-weight:600}
.book .wrap{display:grid;gap:36px}@media(min-width:900px){.book .wrap{grid-template-columns:1fr 1fr}}
.embed{width:100%;min-height:640px;border:1px solid var(--line);border-radius:var(--r);background:#fff}
form{display:grid;gap:12px}label{font-size:14px;font-weight:600;display:grid;gap:6px}
input,textarea{width:100%;font:inherit;font-weight:400;padding:12px 14px;border:1px solid var(--line);border-radius:var(--r);background:#fff;color:var(--ink)}textarea{min-height:110px}
.fine{font-size:13px;color:var(--muted)}.hp{position:absolute;left:-9999px}
.thanks{background:#E7F7EE;color:#0B4A2A;padding:14px;border-radius:var(--r)}
footer{background:var(--ink);color:#E9ECEF;font-size:15px;padding:40px 0 110px}footer p{margin:4px 0}footer .name{font-size:24px;margin-bottom:10px}
@media(min-width:641px){footer{padding-bottom:40px}}
.bar{position:fixed;left:0;right:0;bottom:0;display:grid;grid-template-columns:1fr 1fr;z-index:10;box-shadow:0 -1px 0 var(--line)}
.bar a{text-align:center;padding:16px 8px;font-weight:600;text-decoration:none}.bar .call{background:var(--surface);color:var(--ink)}.bar .est{background:var(--accent);color:var(--on-accent)}
@media(min-width:641px){.bar{display:none}}
</style></head>
<body>
${m.published ? '' : `<div class="ready"><strong>Preview, not public yet.</strong> ${ready.missing.length ? `Still needed: ${esc(ready.missing.join('; '))}.` : 'Ready to publish.'}</div>`}
<header class="top"><div class="wrap">
  <div><a class="name" href="${esc(base)}">${esc(m.name)}</a>${m.license ? `<div class="lic">${esc(m.license)}</div>` : ''}</div>
  ${tel ? `<a class="top-call" href="${esc(tel)}">${esc(phone)}</a>` : ''}
</div></header>
<div class="hero"><div class="wrap">
  <div>
    <h1>${esc(h1)}</h1>
    ${m.tagline ? `<p class="tag">${esc(m.tagline)}</p>` : ''}
    ${m.subhead ? `<p class="sub">${esc(m.subhead)}</p>` : ''}
    <div class="hero-actions">
      <a class="btn" href="#book">Book my free estimate</a>
      ${tel ? `<a class="tel" href="${esc(tel)}">or call ${esc(phone)}</a>` : ''}
    </div>
    <div class="trust">
      ${m.rating && m.reviewCount ? `<p>${esc(m.rating.toFixed(1))} stars from ${esc(m.reviewCount)} Google reviews</p>` : ''}
      ${trustLine.map((t) => `<p>${esc(t)}</p>`).join('')}
    </div>
  </div>
  ${m.projects[0] ? `<img class="hero-shot" src="${esc(m.projects[0].after)}" alt="${esc(`${m.name} project${m.projects[0].caption ? `: ${m.projects[0].caption}` : ''}`)}" width="1200" height="900">`
    : m.photos[0] ? `<img class="hero-shot" src="${esc(m.photos[0])}" alt="${esc(`${m.name} at work`)}" width="1200" height="900">` : ''}
</div></div>
${lead ? `<section class="band"><div class="wrap">
  <h2>What we do</h2>
  <div class="svc-lead"><h3>${esc(lead.name)}</h3>${lead.blurb ? `<p>${esc(lead.blurb)}</p>` : ''}</div>
  ${rest.length ? `<div class="svc-rest">${rest.map((s) => `<div><h3>${esc(s.name)}</h3>${s.blurb ? `<p>${esc(s.blurb)}</p>` : ''}</div>`).join('')}</div>` : ''}
</div></section>` : ''}
${m.projects.length ? `<section><div class="wrap"><h2>Recent work</h2><div class="proof">${m.projects.slice(0, 8).map((p, i) => beforeAfter(p, i, m.name)).join('')}</div></div></section>`
  : m.photos.length ? `<section><div class="wrap"><h2>Recent work</h2><div class="photos">${m.photos.map((u) => `<img src="${esc(u)}" alt="${esc(`${m.name} project`)}" loading="lazy">`).join('')}</div></div></section>` : ''}
${m.reviews.length ? `<section class="band"><div class="wrap">
  <h2>What customers say</h2>
  ${m.rating && m.reviewCount ? `<p class="rating">${esc(m.rating.toFixed(1))} out of 5 on Google, ${esc(m.reviewCount)} reviews${m.reviewsUrl ? `. <a href="${esc(m.reviewsUrl)}">Read them on Google</a>` : ''}</p>` : ''}
  <div class="reviews">${m.reviews.slice(0, 6).map((r) => `<blockquote><p>“${esc(r.text)}”</p>${r.name ? `<cite>${esc(r.name)}</cite>` : ''}</blockquote>`).join('')}</div>
</div></section>` : ''}
${m.about ? `<section><div class="wrap"><h2>About ${esc(m.name)}</h2><p style="font-size:19px;max-width:62ch">${esc(m.about)}</p></div></section>` : ''}
${m.areas.length ? `<section class="areas band"><div class="wrap"><h2>Where we work</h2>
  <p>${m.areas.map((a, i) => `${i && i === m.areas.length - 1 ? 'and ' : ''}<a href="${esc(pageUrl(base, a))}">${esc(a)}</a>`).join(m.areas.length > 2 ? ', ' : ' ')}.</p>
</div></section>` : ''}
<section class="book" id="book"><div class="wrap">
  <div>
    <h2>Book a free estimate</h2>
    <p class="fine" style="font-size:16px">${m.booking ? 'Pick a time that works, or send us the details and we will text you back.' : 'Send the details and we will text you back, usually within a minute.'}${tel ? ` In a hurry? Call <a href="${esc(tel)}">${esc(phone)}</a>, answered day and night.` : ''}</p>
    ${m.booking ? `<iframe class="embed" src="${esc(m.booking)}" title="Book a time with ${esc(m.name)}" loading="lazy"></iframe>` : ''}
  </div>
  <form method="POST" action="${esc(formAction)}">
    ${thanks ? '<div class="thanks"><strong>Got it, thanks.</strong> Check your phone for a text from us.</div>' : ''}
    <label>Your name<input name="name" autocomplete="name" required></label>
    <label>Phone<input name="phone" type="tel" autocomplete="tel" required></label>
    <label>Address or ZIP<input name="address" autocomplete="street-address"></label>
    <label>What's going on?<textarea name="message" placeholder="A leak over the garage, a quote for a new system…"></textarea></label>
    <input class="hp" name="company_website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <input type="hidden" name="_redirect" value="${esc(`${self}?thanks=1#book`)}">
    <button class="btn" type="submit">Send my request</button>
    <p class="fine">By sending, you agree we can call or text you about your request. Reply STOP anytime.</p>
  </form>
</div></section>
<footer><div class="wrap">
  <div class="name">${esc(m.name)}</div>
  ${tel ? `<p><a href="${esc(tel)}">${esc(phone)}</a></p>` : ''}
  ${m.hours ? `<p>Office hours: ${esc(m.hours)}. Calls answered day and night.</p>` : ''}
  ${m.license ? `<p>${esc(m.license)}${m.licenseLimit ? `, monetary limit ${esc(m.licenseLimit)}` : ''}</p>` : ''}
  ${m.insured ? '<p>Licensed, bonded and insured.</p>' : ''}
  <p>© ${new Date().getFullYear()} ${esc(m.name)}</p>
</div></footer>
${tel ? `<nav class="bar" aria-label="Contact"><a class="call" href="${esc(tel)}">Call ${esc(phone)}</a><a class="est" href="#book">Free estimate</a></nav>` : ''}
${m.projects.length ? `<script>document.querySelectorAll('.ba-frame').forEach(function(f){var r=f.querySelector('.ba-range');r.addEventListener('input',function(){f.style.setProperty('--pos',r.value+'%')})})</script>` : ''}
</body></html>`;
}

export function renderSitemap(client, base) {
  const m = siteModel(client);
  const urls = [base, ...m.areas.map((a) => pageUrl(base, a))];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
}

export const renderRobots = (base, published) =>
  published ? `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n';
