/**
 * Client websites.
 *   /s/:slug[/:area]                     preview / default address (vercel.json rewrite)
 *   https://<customer-domain>/[area]     via middleware.js (host → ?host=&path=)
 *   …/sitemap.xml, …/robots.txt          on custom domains
 * See lib/site.js.
 */

import { supabase } from '../lib/supabase.js';
import { renderSitePage, renderSitemap, renderRobots, siteModel, slugifyArea } from '../lib/site.js';

const appBase = () =>
  (process.env.DEPLOYMENT_URL || process.env.DASHBOARD_URL || `https://${process.env.VERCEL_DOMAIN}`).replace(/\/$/, '');

export default async function handler(req, res) {
  const q = req.query ?? {};
  const host = String(q.host ?? '').toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');
  let client = null;
  let base;
  let path;
  if (host) {
    ({ data: client } = await supabase.from('clients').select('*').eq('site->>domain', host).eq('active', true).maybeSingle());
    base = `https://${host}`;
    path = String(q.path ?? '/');
  } else if (q.slug) {
    ({ data: client } = await supabase.from('clients').select('*').eq('slug', String(q.slug)).eq('active', true).maybeSingle());
    base = `${appBase()}/s/${q.slug}`;
    path = q.area ? `/${q.area}` : '/';
  }
  if (!client) return res.status(404).setHeader('Content-Type', 'text/plain').send('Not found');

  const m = siteModel(client);
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
  if (path === '/sitemap.xml') { res.setHeader('Content-Type', 'application/xml'); return res.status(200).send(renderSitemap(client, base)); }
  if (path === '/robots.txt') { res.setHeader('Content-Type', 'text/plain'); return res.status(200).send(renderRobots(base, m.published)); }

  const areaSlug = path.replace(/^\/+|\/+$/g, '');
  const area = areaSlug ? m.areas.find((a) => slugifyArea(a) === areaSlug) : null;
  if (areaSlug && !area) return res.status(404).setHeader('Content-Type', 'text/plain').send('Not found');

  const formAction = client.lead_key ? `/api/leads/form?key=${client.lead_key}` : '#';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(renderSitePage(client, { area, base, formAction, thanks: q.thanks === '1' }));
}
