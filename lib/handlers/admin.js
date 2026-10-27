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
 */

import crypto from 'node:crypto';
import { supabase } from '../supabase.js';
import { configFromClient, previewClient, provisionClient, validateConfig, forwardingCodes } from '../provision.js';
import { syncAssistantPhone } from '../clients.js';
import { getBusy, serviceAccountEmail } from '../googleCalendar.js';
import { prettyPhone } from '../phone.js';

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

const publicClient = ({ dashboard_password, ...c }) => ({ ...c, has_password: Boolean(dashboard_password) });

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
  const to = client.owner_phone;
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

const ACTIONS = {
  status:             { method: 'GET',  run: status },
  preview:            { method: 'POST', run: preview },
  provision:          { method: 'POST', run: provision },
  toggle:             { method: 'POST', run: toggle },
  'a2p-attach':       { method: 'POST', run: a2pAttach },
  'calendar-check':   { method: 'POST', run: calendarCheck },
  'send-credentials': { method: 'POST', run: sendCredentials },
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
