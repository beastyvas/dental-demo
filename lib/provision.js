/**
 * Client provisioning — everything scripts/onboard.js used to do inline, so
 * the CLI and the CRM (via /api/admin/provision) share one code path.
 *
 *   validateConfig(cfg)            → list of problems ([] = ok)
 *   previewClient(cfg)             → { firstMessage, systemPrompt }
 *   provisionClient(cfg, opts)     → creates/updates assistant, number, DB row
 *   configFromClient(row)          → onboarding config from a clients row
 *   forwardingCodes(number)        → carrier codes for "forward on no answer"
 *
 * Idempotent: matched by slug, so re-running pushes config changes.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { renderPrompt, renderFirstMessage, TRADES } from './prompt.js';
import { ANALYSIS_PLAN } from './calls.js';
import { toE164, prettyPhone } from './phone.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const REQUIRED_FIELDS = ['slug', 'business_name', 'trade', 'agent_name', 'owner_name', 'owner_phone'];
export const PROVISION_ENV = ['VAPI_API_KEY', 'VAPI_WEBHOOK_SECRET', 'TEMPLATE_ASSISTANT_ID',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

/** Problems that would stop provisioning. `buyNumber` = OK to have no twilio_number yet. */
export function validateConfig(cfg, { buyNumber = true } = {}) {
  const problems = [];
  for (const k of REQUIRED_FIELDS) if (!cfg?.[k]) problems.push(`missing "${k}"`);
  if (cfg?.trade && !TRADES.includes(cfg.trade)) problems.push(`trade must be one of: ${TRADES.join(', ')}`);
  for (const k of ['owner_phone', 'transfer_phone', 'twilio_number']) {
    if (cfg?.[k] && !toE164(cfg[k])) problems.push(`"${k}" isn't a valid phone number`);
  }
  if (cfg?.area_code && !/^\d{3}$/.test(String(cfg.area_code))) problems.push('"area_code" must be 3 digits');
  if (!cfg?.twilio_number && !buyNumber) problems.push('no "twilio_number" — add one you own, or buy one');
  return problems;
}

/** Phones to E.164; returns a copy. */
export function normalizeConfig(cfg) {
  return {
    ...cfg,
    owner_phone:    toE164(cfg.owner_phone),
    transfer_phone: cfg.transfer_phone ? toE164(cfg.transfer_phone) : null,
    twilio_number:  cfg.twilio_number ? toE164(cfg.twilio_number) : null,
  };
}

export function previewClient(cfg) {
  const c = normalizeConfig(cfg);
  return { firstMessage: renderFirstMessage(c), systemPrompt: renderPrompt(c) };
}

/**
 * The onboarding config for a clients row. clients.config (written by the CRM)
 * wins; columns fill in for rows set up before it existed.
 */
export function configFromClient(row) {
  const cols = {
    slug: row.slug, business_name: row.business_name, trade: row.trade, agent_name: row.agent_name,
    owner_phone: row.owner_phone, transfer_phone: row.transfer_phone, service_area: row.service_area,
    timezone: row.timezone, business_hours: row.business_hours, calendar_id: row.calendar_id,
    twilio_number: row.twilio_number, plan: row.plan, included_minutes: row.included_minutes,
  };
  const fromCols = Object.fromEntries(Object.entries(cols).filter(([, v]) => v != null));
  // slug + business_name always come from the row — they're its identity.
  return { ...fromCols, ...(row.config ?? {}), slug: row.slug, business_name: row.business_name };
}

/** Carrier codes the owner dials to forward no-answer/busy calls to the AI line. */
export function forwardingCodes(number) {
  const ten = String(number).replace(/^\+1/, '');
  return [
    { carrier: 'Verizon',  code: `*71${ten}`,       note: 'no-answer/busy' },
    { carrier: 'AT&T',     code: `*004*${ten}#`,    note: 'no-answer/busy/unreachable' },
    { carrier: 'T-Mobile', code: `**61*${number}#`, note: 'no-answer' },
    { carrier: 'T-Mobile', code: `**67*${number}#`, note: 'busy' },
  ];
}

function loadTool(name, baseUrl, secret) {
  const tool = JSON.parse(readFileSync(resolve(ROOT, 'vapi/tools', `${name}.json`), 'utf8'));
  if (tool.server?.url) tool.server.url = tool.server.url.replace('https://YOUR_VERCEL_DOMAIN.vercel.app', baseUrl);
  tool.server = { ...tool.server, headers: { ...(tool.server?.headers ?? {}), 'x-vapi-secret': secret } };
  return tool;
}

export function assistantBody(cfg, template, { baseUrl, secret }) {
  const tools = ['office-status-tool', 'calendar-availability-tool', 'calendar-book-tool', 'waitlist-tool', 'emergency-tool']
    .map((t) => loadTool(t, baseUrl, secret));
  if (cfg.transfer_phone) {
    tools.push({
      type: 'transferCall',
      destinations: [{
        type: 'number',
        number: cfg.transfer_phone,
        message: `Sure — connecting you to ${cfg.owner_name} now. One moment.`,
        description: `${cfg.owner_name} at ${cfg.business_name}`,
      }],
    });
  }
  return {
    name: cfg.business_name.slice(0, 40),
    firstMessage: renderFirstMessage(cfg),
    model: {
      provider: template.model?.provider,
      model: template.model?.model,
      ...(template.model?.temperature != null ? { temperature: template.model.temperature } : {}),
      messages: [{ role: 'system', content: renderPrompt(cfg) }],
      tools,
    },
    ...(template.voice ? { voice: template.voice } : {}),
    ...(template.transcriber ? { transcriber: template.transcriber } : {}),
    ...(template.startSpeakingPlan ? { startSpeakingPlan: template.startSpeakingPlan } : {}),
    ...(template.stopSpeakingPlan ? { stopSpeakingPlan: template.stopSpeakingPlan } : {}),
    ...(template.backgroundSpeechDenoisingPlan ? { backgroundSpeechDenoisingPlan: template.backgroundSpeechDenoisingPlan } : {}),
    maxDurationSeconds: 900,
    server: { url: `${baseUrl}/api/vapi/events`, headers: { 'x-vapi-secret': secret } },
    serverMessages: ['end-of-call-report'],
    analysisPlan: ANALYSIS_PLAN,
    artifactPlan: { recordingEnabled: true },
    metadata: { slug: cfg.slug, trade: cfg.trade },
  };
}

/**
 * Create or update everything for one client. `log` gets one line per step.
 * Returns { client, password, isNew, number }.
 */
export async function provisionClient(rawCfg, { buyNumber = false, baseUrl, log = () => {} } = {}) {
  const problems = validateConfig(rawCfg, { buyNumber });
  if (problems.length) throw Object.assign(new Error(problems.join('; ')), { problems });
  const missingEnv = PROVISION_ENV.filter((k) => !process.env[k]);
  if (missingEnv.length) throw new Error(`Missing env vars: ${missingEnv.join(', ')}`);
  if (!baseUrl) throw new Error('baseUrl is required');

  const cfg = normalizeConfig(rawCfg);
  const base = baseUrl.replace(/\/$/, '');
  const secret = process.env.VAPI_WEBHOOK_SECRET;

  const { supabase } = await import('./supabase.js');
  const vapi = await import('./vapi.js');
  const twilio = await import('./twilio.js');

  const { data: existing } = await supabase.from('clients').select('*').eq('slug', cfg.slug).maybeSingle();
  // Rows created at "close deal" have no assistant yet (agent_id null).
  const existingAgent = existing?.agent_id || null;

  // ── Assistant ──
  const template = await vapi.getAssistant(process.env.TEMPLATE_ASSISTANT_ID);
  const body = assistantBody(cfg, template, { baseUrl: base, secret });
  const assistant = existingAgent
    ? await vapi.updateAssistant(existingAgent, body)
    : await vapi.createAssistant(body);
  log(`assistant ${existingAgent ? 'updated' : 'created'} ${assistant.id} (${body.model.tools.length} tools)`);

  // ── Twilio number ──
  let number = cfg.twilio_number ?? existing?.twilio_number ?? null;
  let numberSid = existing?.twilio_number_sid ?? null;
  if (!number) {
    const bought = await twilio.buyLocalNumber(cfg.area_code || '702', `${cfg.business_name} (AI line)`);
    number = bought.phone_number;
    numberSid = bought.sid;
    log(`bought ${prettyPhone(number)} (${numberSid})`);
  } else if (!numberSid) {
    const owned = await twilio.findOwnedNumber(number);
    if (!owned) throw new Error(`${number} isn't in this Twilio account.`);
    numberSid = owned.sid;
    log(`using ${prettyPhone(number)} (${numberSid})`);
  } else {
    log(`using ${prettyPhone(number)} (${numberSid})`);
  }
  await twilio.setSmsWebhook(numberSid, `${base}/api/twilio/sms`);
  log(`SMS webhook → ${base}/api/twilio/sms`);

  // ── Vapi phone number ──
  const fallback = { type: 'number', number: cfg.transfer_phone || cfg.owner_phone };
  let vapiPhoneId = existing?.vapi_phone_number_id ?? null;
  if (vapiPhoneId) {
    await vapi.updatePhoneNumber(vapiPhoneId, { assistantId: assistant.id, fallbackDestination: fallback, name: cfg.business_name.slice(0, 40) });
    log(`Vapi number updated ${vapiPhoneId}`);
  } else {
    const phone = await vapi.createPhoneNumber({
      provider: 'twilio',
      number,
      twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
      twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
      assistantId: assistant.id,
      name: cfg.business_name.slice(0, 40),
      smsEnabled: false, // keep OUR SMS webhook on the number — Vapi would overwrite it
      fallbackDestination: fallback,
    });
    vapiPhoneId = phone.id;
    log(`imported ${prettyPhone(number)} into Vapi → ${vapiPhoneId}`);
  }

  // ── Database row ──
  const isNew = !existingAgent;
  const password = existing?.dashboard_password ?? String(crypto.randomInt(100000, 999999));
  const { slug, business_name, ...configRest } = cfg;
  const row = {
    slug,
    business_name,
    agent_id:             assistant.id,
    dashboard_password:   password,
    owner_phone:          cfg.owner_phone,
    transfer_phone:       cfg.transfer_phone,
    doctor_phone:         existing?.doctor_phone ?? cfg.owner_phone,
    front_desk_phone:     existing?.front_desk_phone ?? cfg.owner_phone,
    timezone:             cfg.timezone || 'America/Los_Angeles',
    trade:                cfg.trade,
    agent_name:           cfg.agent_name,
    service_area:         cfg.service_area ?? null,
    business_hours:       cfg.business_hours ?? null,
    calendar_id:          cfg.calendar_id ?? null,
    twilio_number:        number,
    twilio_number_sid:    numberSid,
    vapi_phone_number_id: vapiPhoneId,
    demo_phone:           prettyPhone(number),
    plan:                 cfg.plan ?? 'answer_desk',
    included_minutes:     cfg.included_minutes ?? 500,
    active:               true,
    config:               { ...configRest, twilio_number: number },
    provisioned_at:       new Date().toISOString(),
    lead_key:             existing?.lead_key ?? crypto.randomBytes(16).toString('hex'),
  };
  let { data: client, error } = await supabase.from('clients').upsert([row], { onConflict: 'slug' }).select().single();
  if (error && /config|provisioned_at|lead_key/.test(error.message)) {
    // DB without sql/018–019 yet — keep the CLI working.
    delete row.config; delete row.provisioned_at; delete row.lead_key;
    ({ data: client, error } = await supabase.from('clients').upsert([row], { onConflict: 'slug' }).select().single());
  }
  if (error) throw new Error(`clients upsert failed: ${error.message} — did you run the latest sql/ migration?`);
  log(`clients row ${existing ? 'updated' : 'created'}`);

  return { client, password, isNew, number, fallbackNumber: fallback.number };
}
