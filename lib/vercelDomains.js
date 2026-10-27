/**
 * Customer domains on this Vercel project (their website is served by
 * middleware.js → api/site.js). Env: VERCEL_TOKEN, VERCEL_PROJECT_ID,
 * VERCEL_TEAM_ID (if the project is under a team).
 */

const API = 'https://api.vercel.com';
export const domainsConfigured = () => Boolean(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID);

async function vercel(method, path, body) {
  const team = process.env.VERCEL_TEAM_ID ? `${path.includes('?') ? '&' : '?'}teamId=${process.env.VERCEL_TEAM_ID}` : '';
  const r = await fetch(`${API}${path}${team}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export function normalizeDomain(input) {
  const d = String(input ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null;
}

/** DNS the owner (or whoever runs their DNS) needs to set. */
export const dnsRecords = (domain) => [
  { type: 'A', name: '@', value: '76.76.21.21', for: domain },
  { type: 'CNAME', name: 'www', value: 'cname.vercel-dns.com', for: `www.${domain}` },
];

/** Add apex + www (www redirects to apex). Already-added domains are fine. */
export async function addDomain(domain) {
  const project = process.env.VERCEL_PROJECT_ID;
  const results = [];
  for (const body of [{ name: domain }, { name: `www.${domain}`, redirect: domain, redirectStatusCode: 308 }]) {
    const r = await vercel('POST', `/v10/projects/${project}/domains`, body);
    const taken = r.status === 409 && /already/i.test(r.data?.error?.message ?? '');
    if (!r.ok && !taken) throw new Error(`Vercel: ${r.data?.error?.message ?? r.status}`);
    results.push({ name: body.name, verified: r.data?.verified ?? null, verification: r.data?.verification ?? [] });
  }
  return results;
}

/** Is DNS pointed at us yet? */
export async function domainStatus(domain) {
  const [apex, www] = await Promise.all([
    vercel('GET', `/v6/domains/${domain}/config`),
    vercel('GET', `/v6/domains/www.${domain}/config`),
  ]);
  return {
    domain,
    configured: apex.ok && apex.data?.misconfigured === false,
    wwwConfigured: www.ok && www.data?.misconfigured === false,
  };
}
