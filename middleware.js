/**
 * Vercel Routing Middleware: requests for a customer's own domain render
 * their website (api/site.js). Our own hosts — APP_HOSTS (comma-separated),
 * DASHBOARD_URL / DEPLOYMENT_URL / VERCEL_DOMAIN, *.vercel.app, localhost —
 * pass straight through. /api/* always passes, so
 * a site's quote form can post to /api/leads/form on its own domain.
 */

export const config = { matcher: '/((?!api/|assets/).*)' };

export default function middleware(request) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  // Our own hosts, from every place the app already names its address — a
  // missing APP_HOSTS must never turn the dashboard into a "customer site".
  const own = [
    ...(process.env.APP_HOSTS ?? '').split(','),
    process.env.DASHBOARD_URL, process.env.DEPLOYMENT_URL, process.env.VERCEL_DOMAIN,
    process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_URL,
  ].map((h) => String(h ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, '')).filter(Boolean);
  if (own.includes(host) || host.endsWith('.vercel.app') || host === 'localhost' || host === '127.0.0.1') {
    return new Response(null, { headers: { 'x-middleware-next': '1' } });
  }
  const target = new URL('/api/site', url);
  target.searchParams.set('host', host);
  target.searchParams.set('path', url.pathname);
  if (url.searchParams.get('thanks')) target.searchParams.set('thanks', url.searchParams.get('thanks'));
  return new Response(null, { headers: { 'x-middleware-rewrite': target.toString() } });
}
