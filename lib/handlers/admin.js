/**
 * /api/admin/:action — server-to-server provisioning API for the CRM
 * (nickbuilds.org). Auth: `Authorization: Bearer <ADMIN_API_SECRET>`; never
 * called from a browser. Every action takes { client_id }.
 *
 *   GET  status            client + onboarding checklist + recent calls
 *   POST preview           rendered first message + prompt (body may carry a draft `config`)
 *   POST provision         create/update assistant + number + row ({ buy_number })
 *   POST toggle            AI on/off ({ assistant_active })
 *   POST a2p-attach        add the number to TWILIO_MESSAGING_SERVICE_SID
 *   POST calendar-check    FreeBusy probe — proves the calendar is shared
 *   POST send-credentials  text the owner the dashboard link + password
 *   POST text-owner        text the owner anything ({ body }) — order form, agreement links
 *   POST jobber-connect    the Jobber OAuth link the owner opens to connect their account
 *   POST reactivation      { rows, template?, consent_attested, dry_run? } | { cancel: true }
 *   POST domain-connect    { domain } add a customer's domain for their website
 *   POST domain-status     is their DNS pointed at us yet?
 *   POST a2p-register      { info } start the business's own A2P 10DLC registration
 *   POST a2p-status        check Twilio and move the registration forward
 */

import crypto from 'node:crypto';
import { supabase } from '../supabase.js';
import { configFromClient, previewClient, provisionClient, validateConfig, forwardingCodes } from '../provision.js';
import { syncAssistantPhone } from '../clients.js';
import { getBusy, serviceAccountEmail } from '../googleCalendar.js';
import { prettyPhone, toE164 } from '../phone.js';
import { leadEmailAddress } from '../leadParse.js';
import { automationFor } from '../automation.js';
import { jobberConfigured, authorizeUrl } from '../jobber.js';
import { planCampaign } from '../reactivation.js';
import { cancelPending } from '../followups.js';
import { domainsConfigured, normalizeDomain, addDomain, domainStatus, dnsRecords } from '../vercelDomains.js';
import * as a2p from '../a2p.js';

export function isAdminRequest(req) {
  const secret = process.env.ADMIN_API_SECRET;
  const header = req.headers.authorization ?? '';
  if (!secret || !header.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const baseUrl = () =>
  (process.env.DEPLOYMENT_URL || process.env.DASHBOARD_URL || `https://${process.env.VERCEL_DOMAIN}`).replace(/\/$/, '');

async function loadClient(id) {
  if (!id) return { error: 'client_id is required' };
  const { data, error } = await supabase.from('clients').select('*').eq('id', id).maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: 'client not found', status: 404 };
  return { client: data };
}

/** Merge into clients.onboarding_steps ({ step: { done, at, ...detail } }). */
async function markStep(client, step, detail = {}) {
  const steps = { ...(client.onboarding_steps ?? {}), [step]: { done: true, at: new Date().toISOString(), ...detail } };
  await supabase.from('clients').update({ onboarding_steps: steps }).eq('id', client.id);
  return steps;
}

// Never hand out the dashboard password or OAuth tokens.
const publicClient = ({ dashboard_password, integrations, a2p: a2pState, ...c }) => ({
  ...c,
  a2p: a2p.publicA2p(a2pState),
  has_password: Boolean(dashboard_password),
  integrations: {
    jobber: integrations?.jobber?.account_id
      ? { connected: true, account_name: integrations.jobber.account_name ?? null, connected_at: integrations.jobber.connected_at ?? null }
      : { connected: false },
  },
});

async function reactivationCounts(clientId) {
  const { data } = await supabase.from('followups').select('status').eq('client_id', clientId).eq('kind', 'reactivation');
  const c = { pending: 0, sent: 0, skipped: 0, failed: 0, cancelled: 0 };
  for (const r of data ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
  return c;
}

async function status(req, res, client) {
  const since = client.provisioned_at ?? client.created_at;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const [{ data: recent }, { data: month }, { count: errors }] = await Promise.all([
    supabase.from('calls').select('id, caller_phone, caller_name, started_at, duration_seconds, outcome, summary')
      .eq('client_id', client.id).gte('created_at', since).order('created_at', { ascending: false }).limit(10),
    supabase.from('calls').select('duration_seconds').eq('client_id', client.id).gte('created_at', monthStart),
    supabase.from('calls').select('*', { count: 'exact', head: true })
      .eq('client_id', client.id).eq('outcome', 'error').gte('created_at', monthStart),
  ]);
  const minutes = Math.round((month ?? []).reduce((s, c) => s + (c.duration_seconds ?? 0), 0) / 60);
  return res.status(200).json({
    client: publicClient(client),
    problems: validateConfig(configFromClient(client)),
    recentCalls: recent ?? [],
    usage: { callsThisMonth: month?.length ?? 0, minutesThisMonth: minutes, includedMinutes: client.included_minutes, errorsThisMonth: errors ?? 0 },
    forwarding: client.twilio_number ? forwardingCodes(client.twilio_number) : [],
    calendarShareWith: serviceAccountEmail(),
    a2pAvailable: Boolean(process.env.TWILIO_MESSAGING_SERVICE_SID),
    dashboardUrl: baseUrl(),
    automation: automationFor(client),
    reactivation: await reactivationCounts(client.id),
    leadCapture: client.lead_key ? {
      formUrl: `${baseUrl()}/api/leads/form?key=${client.lead_key}`,
      emailAddress: leadEmailAddress(client),
      hcpWebhookUrl: `${baseUrl()}/api/leads/hcp?key=${client.lead_key}`,
      jobWebhookUrl: `${baseUrl()}/api/leads/job-complete?key=${client.lead_key}`,
    } : null,
    jobberAvailable: jobberConfigured(),
    a2pRegistration: { available: a2p.a2pConfigured(), businessTypes: a2p.BUSINESS_TYPES, jobPositions: a2p.JOB_POSITIONS },
    site: {
      previewUrl: `${baseUrl()}/s/${client.slug}`,
      domain: client.site?.domain ?? null,
      domainsAvailable: domainsConfigured(),
      dns: client.site?.domain ? dnsRecords(client.site.domain) : [],
    },
  });
}

async function preview(req, res, client) {
  const cfg = { ...configFromClient(client), ...(req.body?.config ?? {}), slug: client.slug, business_name: client.business_name };
  const problems = validateConfig(cfg);
  if (problems.some((p) => p.includes('trade'))) return res.status(200).json({ problems });
  return res.status(200).json({ problems, ...previewClient(cfg) });
}

async function provision(req, res, client) {
  const lines = [];
  try {
    const result = await provisionClient(configFromClient(client), {
      buyNumber: Boolean(req.body?.buy_number), baseUrl: baseUrl(), log: (m) => lines.push(m),
    });
    const steps = await markStep(result.client, 'provisioned', { number: result.number });
    return res.status(200).json({ client: publicClient({ ...result.client, onboarding_steps: steps }), log: lines, isNew: result.isNew });
  } catch (err) {
    console.error('[admin/provision]', client.slug, err.message);
    return res.status(err.problems ? 400 : 502).json({ error: err.message, problems: err.problems, log: lines });
  }
}

async function toggle(req, res, client) {
  const active = req.body?.assistant_active;
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'assistant_active must be a boolean' });
  try {
    const phoneSynced = await syncAssistantPhone(client.id, active);
    await supabase.from('clients').update({ assistant_active: active }).eq('id', client.id);
    return res.status(200).json({ assistant_active: active, phoneSynced });
  } catch (err) {
    return res.status(502).json({ error: `Phone system unreachable — not switched (${err.message})` });
  }
}

async function a2pAttach(req, res, client) {
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!service) return res.status(400).json({ error: 'TWILIO_MESSAGING_SERVICE_SID is not set' });
  if (!client.twilio_number_sid) return res.status(400).json({ error: 'Provision the client first — no Twilio number yet' });
  try {
    const { attachToMessagingService } = await import('../twilio.js');
    const r = await attachToMessagingService(service, client.twilio_number_sid);
    const steps = await markStep(client, 'a2p', { alreadyAttached: r.alreadyAttached });
    return res.status(200).json({ ...r, onboarding_steps: steps });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}

async function calendarCheck(req, res, client) {
  const calendarId = client.calendar_id ?? client.config?.calendar_id;
  if (!calendarId) return res.status(400).json({ error: 'No calendar_id on this client' });
  const now = Date.now();
  const r = await getBusy({ calendarId, fromMs: now, toMs: now + 86_400_000 });
  if (!r.ok) return res.status(200).json({ ok: false, error: r.error, shareWith: serviceAccountEmail() });
  const steps = await markStep(client, 'calendar', { calendarId });
  return res.status(200).json({ ok: true, onboarding_steps: steps });
}

async function sendCredentials(req, res, client) {
  if (!client.dashboard_password) return res.status(400).json({ error: 'Provision the client first — no password yet' });
  const to = ownerPhone(client);
  if (!to) return res.status(400).json({ error: 'No owner_phone on this client' });
  const body = `${client.business_name}: your AI receptionist dashboard is ${baseUrl()} — password ${client.dashboard_password}. `
    + `Your AI line is ${prettyPhone(client.twilio_number)}. Reply STOP to opt out.`;
  try {
    const { sendSMS } = await import('../sms.js');
    // From the system number — the client's own may not be on the A2P campaign yet.
    await sendSMS(to, body, { client, kind: 'other', from: process.env.TWILIO_DEFAULT_FROM ?? null });
    const steps = await markStep(client, 'credentials', { to });
    return res.status(200).json({ sent: true, onboarding_steps: steps });
  } catch (err) {
    return res.status(err.optedOut ? 409 : 502).json({ error: err.message });
  }
}

// Before provisioning the owner's cell only lives in the CRM's onboarding config.
const ownerPhone = (client) => client.owner_phone ?? toE164(client.config?.owner_phone);

async function textOwner(req, res, client) {
  const body = String(req.body?.body ?? '').trim();
  if (!body || body.length > 600) return res.status(400).json({ error: 'body must be 1–600 characters' });
  const to = ownerPhone(client);
  if (!to) return res.status(400).json({ error: "No owner cell on file — add it in the setup form" });
  try {
    const { sendSMS } = await import('../sms.js');
    await sendSMS(to, body, { client, kind: 'other', from: process.env.TWILIO_DEFAULT_FROM ?? null });
    return res.status(200).json({ sent: true, to });
  } catch (err) {
    return res.status(err.optedOut ? 409 : 502).json({ error: err.message });
  }
}

async function jobberConnect(req, res, client) {
  if (!jobberConfigured()) return res.status(400).json({ error: 'Set JOBBER_CLIENT_ID and JOBBER_CLIENT_SECRET on the receptionist first' });
  return res.status(200).json({ url: authorizeUrl(client.id, baseUrl()) });
}

async function reactivation(req, res, client) {
  const b = req.body ?? {};
  if (b.cancel) {
    const cancelled = await cancelPending({ clientId: client.id, kinds: ['reactivation'] });
    return res.status(200).json({ cancelled });
  }
  if (!Array.isArray(b.rows) || !b.rows.length) return res.status(400).json({ error: 'rows is required' });
  if (!b.dry_run && b.consent_attested !== true) {
    return res.status(400).json({ error: 'Confirm these customers gave the business their number for texts' });
  }
  try {
    return res.status(200).json(await planCampaign(client, b.rows, { template: b.template, dryRun: Boolean(b.dry_run) }));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function connectDomain(req, res, client) {
  if (!domainsConfigured()) return res.status(400).json({ error: 'Set VERCEL_TOKEN and VERCEL_PROJECT_ID on the receptionist first' });
  const domain = normalizeDomain(req.body?.domain);
  if (!domain) return res.status(400).json({ error: 'Enter a domain like desertairhvac.com' });
  const { data: other } = await supabase.from('clients').select('id').eq('site->>domain', domain).neq('id', client.id).limit(1);
  if (other?.length) return res.status(409).json({ error: 'Another customer already uses that domain' });
  try {
    await addDomain(domain);
    await supabase.from('clients').update({ site: { ...(client.site ?? {}), domain } }).eq('id', client.id);
    return res.status(200).json({ domain, dns: dnsRecords(domain), status: await domainStatus(domain) });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}

async function checkDomain(req, res, client) {
  const domain = client.site?.domain;
  if (!domain) return res.status(400).json({ error: 'No domain connected yet' });
  if (!domainsConfigured()) return res.status(400).json({ error: 'Set VERCEL_TOKEN and VERCEL_PROJECT_ID on the receptionist first' });
  return res.status(200).json({ ...(await domainStatus(domain)), dns: dnsRecords(domain) });
}

async function a2pRegister(req, res, client) {
  try {
    const state = await a2p.start(client, req.body?.info ?? {});
    return res.status(200).json({ a2p: a2p.publicA2p(state) });
  } catch (err) {
    return res.status(err.status ?? 502).json({ error: err.message });
  }
}

async function a2pStatus(req, res, client) {
  const state = await a2p.advance(client, { baseUrl: baseUrl() });
  return res.status(200).json({ a2p: a2p.publicA2p(state) });
}

const ACTIONS = {
  status:             { method: 'GET',  run: status },
  preview:            { method: 'POST', run: preview },
  provision:          { method: 'POST', run: provision },
  toggle:             { method: 'POST', run: toggle },
  'a2p-attach':       { method: 'POST', run: a2pAttach },
  'calendar-check':   { method: 'POST', run: calendarCheck },
  'send-credentials': { method: 'POST', run: sendCredentials },
  'text-owner':       { method: 'POST', run: textOwner },
  'jobber-connect':   { method: 'POST', run: jobberConnect },
  'reactivation':     { method: 'POST', run: reactivation },
  'domain-connect':   { method: 'POST', run: connectDomain },
  'domain-status':    { method: 'POST', run: checkDomain },
  'a2p-register':     { method: 'POST', run: a2pRegister },
  'a2p-status':       { method: 'POST', run: a2pStatus },
};

export default async function handler(req, res) {
  if (!isAdminRequest(req)) return res.status(401).json({ error: 'Unauthorized' });
  const action = ACTIONS[req.query.action];
  if (!action) return res.status(404).json({ error: `Unknown action: ${req.query.action}` });
  if (req.method !== action.method) return res.status(405).json({ error: 'Method not allowed' });
  const { client, error, status: code } = await loadClient(req.method === 'GET' ? req.query.client_id : req.body?.client_id);
  if (error) return res.status(code ?? 400).json({ error });
  return action.run(req, res, client);
}
