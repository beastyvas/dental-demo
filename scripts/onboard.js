/**
 * scripts/onboard.js — set up a new client end to end from clients/<slug>.json.
 *
 *   node scripts/onboard.js <slug> --dry-run      print the rendered prompt + plan, touch nothing
 *   node scripts/onboard.js <slug>                create/update everything (uses an existing Twilio number)
 *   node scripts/onboard.js <slug> --buy-number   also buy a local Twilio number if the config has none
 *
 * Idempotent: re-running updates the same assistant, phone number and DB row
 * (matched by slug), so it's also how you push prompt/config changes.
 *
 * What it does:
 *   1. Renders the system prompt + first message from the trade template
 *   2. Creates/updates the Vapi assistant (model/voice/transcriber copied from TEMPLATE_ASSISTANT_ID)
 *   3. Buys (with --buy-number) or looks up the Twilio number; points its SMS webhook at us
 *   4. Imports the number into Vapi with the assistant + a fallback to the owner
 *   5. Upserts the clients row (prints a new dashboard password the first time)
 *   6. Prints the go-live checklist
 *
 * Env (.env.local or shell): VAPI_API_KEY, VAPI_WEBHOOK_SECRET, DEPLOYMENT_URL,
 *   TEMPLATE_ASSISTANT_ID, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── .env.local loader (same as vapi-sync.js) ──────────────────────────────────
try {
  for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const k = t.slice(0, t.indexOf('=')).trim();
    const v = t.slice(t.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
} catch { /* optional */ }

const { renderPrompt, renderFirstMessage, TRADES } = await import('../lib/prompt.js');
const { ANALYSIS_PLAN } = await import('../lib/calls.js');
const { toE164, prettyPhone } = await import('../lib/phone.js');

const args   = process.argv.slice(2);
const slug   = args.find((a) => !a.startsWith('--'));
const DRY    = args.includes('--dry-run');
const BUY    = args.includes('--buy-number');

const die = (msg) => { console.error(`\n❌  ${msg}\n`); process.exit(1); };
const step = (msg) => console.log(`\n▸ ${msg}`);

// ── 1. Config ────────────────────────────────────────────────────────────────
if (!slug) die('Usage: node scripts/onboard.js <slug> [--dry-run] [--buy-number]');
const cfgPath = resolve(ROOT, 'clients', `${slug}.json`);
if (!existsSync(cfgPath)) die(`No config at clients/${slug}.json — copy clients/example.json to start.`);
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

const problems = [];
for (const k of ['slug', 'business_name', 'trade', 'agent_name', 'owner_name', 'owner_phone']) if (!cfg[k]) problems.push(`missing "${k}"`);
if (cfg.slug && cfg.slug !== slug && slug !== 'example') problems.push(`"slug" in the file (${cfg.slug}) doesn't match the file name (${slug})`);
if (cfg.trade && !TRADES.includes(cfg.trade)) problems.push(`trade must be one of: ${TRADES.join(', ')}`);
for (const k of ['owner_phone', 'transfer_phone', 'twilio_number']) {
  if (cfg[k] && !toE164(cfg[k])) problems.push(`"${k}" isn't a valid phone number`);
}
if (!cfg.twilio_number && !BUY && !DRY) problems.push('no "twilio_number" in the config — add one you own, or pass --buy-number');
if (problems.length) die(`clients/${slug}.json:\n   - ${problems.join('\n   - ')}`);

cfg.owner_phone    = toE164(cfg.owner_phone);
cfg.transfer_phone = cfg.transfer_phone ? toE164(cfg.transfer_phone) : null;
cfg.twilio_number  = cfg.twilio_number ? toE164(cfg.twilio_number) : null;

const systemPrompt = renderPrompt(cfg);
const firstMessage = renderFirstMessage(cfg);

if (DRY) {
  console.log(`\n── First message ──\n${firstMessage}\n\n── System prompt (${systemPrompt.length} chars) ──\n${systemPrompt}`);
  console.log('── Dry run: nothing was created. ──\n');
  process.exit(0);
}

// ── Env ──────────────────────────────────────────────────────────────────────
const need = ['VAPI_API_KEY', 'VAPI_WEBHOOK_SECRET', 'DEPLOYMENT_URL', 'TEMPLATE_ASSISTANT_ID',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnv = need.filter((k) => !process.env[k]);
if (missingEnv.length) die(`Missing env vars: ${missingEnv.join(', ')}`);

const BASE_URL = process.env.DEPLOYMENT_URL.replace(/\/$/, '');
const SECRET   = process.env.VAPI_WEBHOOK_SECRET;
const { supabase } = await import('../lib/supabase.js');
const { buyLocalNumber, findOwnedNumber, setSmsWebhook } = await import('../lib/twilio.js');

async function vapi(method, path, body) {
  const r = await fetch(`https://api.vapi.ai${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Vapi ${method} ${path} failed (${r.status}): ${text}`);
  return text ? JSON.parse(text) : {};
}

function loadTool(name) {
  const tool = JSON.parse(readFileSync(resolve(ROOT, 'vapi/tools', `${name}.json`), 'utf8'));
  if (tool.server?.url) tool.server.url = tool.server.url.replace('https://YOUR_VERCEL_DOMAIN.vercel.app', BASE_URL);
  tool.server = { ...tool.server, headers: { ...(tool.server?.headers ?? {}), 'x-vapi-secret': SECRET } };
  return tool;
}

const { data: existing } = await supabase.from('clients').select('*').eq('slug', slug).maybeSingle();

// ── 2. Assistant ─────────────────────────────────────────────────────────────
step('Vapi assistant');
const template = await vapi('GET', `/assistant/${process.env.TEMPLATE_ASSISTANT_ID}`);
const tools = ['office-status-tool', 'calendar-availability-tool', 'calendar-book-tool', 'waitlist-tool', 'emergency-tool'].map(loadTool);
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

const assistantBody = {
  name: cfg.business_name.slice(0, 40),
  firstMessage,
  model: {
    provider: template.model?.provider,
    model: template.model?.model,
    ...(template.model?.temperature != null ? { temperature: template.model.temperature } : {}),
    messages: [{ role: 'system', content: systemPrompt }],
    tools,
  },
  ...(template.voice ? { voice: template.voice } : {}),
  ...(template.transcriber ? { transcriber: template.transcriber } : {}),
  ...(template.startSpeakingPlan ? { startSpeakingPlan: template.startSpeakingPlan } : {}),
  ...(template.stopSpeakingPlan ? { stopSpeakingPlan: template.stopSpeakingPlan } : {}),
  ...(template.backgroundSpeechDenoisingPlan ? { backgroundSpeechDenoisingPlan: template.backgroundSpeechDenoisingPlan } : {}),
  maxDurationSeconds: 900,
  server: { url: `${BASE_URL}/api/vapi/events`, headers: { 'x-vapi-secret': SECRET } },
  serverMessages: ['end-of-call-report'],
  analysisPlan: ANALYSIS_PLAN,
  artifactPlan: { recordingEnabled: true },
  metadata: { slug, trade: cfg.trade },
};

const assistant = existing?.agent_id
  ? await vapi('PATCH', `/assistant/${existing.agent_id}`, assistantBody)
  : await vapi('POST', '/assistant', assistantBody);
console.log(`  ${existing?.agent_id ? 'updated' : 'created'} ${assistant.id} (${tools.length} tools, model ${assistantBody.model.provider}/${assistantBody.model.model})`);

// ── 3. Twilio number ─────────────────────────────────────────────────────────
step('Twilio number');
let number = cfg.twilio_number ?? existing?.twilio_number ?? null;
let numberSid = existing?.twilio_number_sid ?? null;
if (!number) {
  const bought = await buyLocalNumber(cfg.area_code || '702', `${cfg.business_name} (AI line)`);
  number = bought.phone_number;
  numberSid = bought.sid;
  console.log(`  bought ${prettyPhone(number)} (${numberSid})`);
} else if (!numberSid) {
  const owned = await findOwnedNumber(number);
  if (!owned) die(`${number} isn't in this Twilio account.`);
  numberSid = owned.sid;
  console.log(`  using ${prettyPhone(number)} (${numberSid})`);
} else {
  console.log(`  using ${prettyPhone(number)} (${numberSid})`);
}
await setSmsWebhook(numberSid, `${BASE_URL}/api/twilio/sms`);
console.log(`  SMS webhook → ${BASE_URL}/api/twilio/sms`);

// ── 4. Vapi phone number ─────────────────────────────────────────────────────
step('Vapi phone number');
const fallback = { type: 'number', number: cfg.transfer_phone || cfg.owner_phone };
let vapiPhoneId = existing?.vapi_phone_number_id ?? null;
if (vapiPhoneId) {
  await vapi('PATCH', `/phone-number/${vapiPhoneId}`, { assistantId: assistant.id, fallbackDestination: fallback, name: cfg.business_name.slice(0, 40) });
  console.log(`  updated ${vapiPhoneId}`);
} else {
  const phone = await vapi('POST', '/phone-number', {
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
  console.log(`  imported ${prettyPhone(number)} → ${vapiPhoneId}`);
}

// ── 5. Database row ──────────────────────────────────────────────────────────
step('Database');
const password = existing?.dashboard_password ?? String(crypto.randomInt(100000, 999999));
const row = {
  slug,
  business_name:        cfg.business_name,
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
};
const { error } = await supabase.from('clients').upsert([row], { onConflict: 'slug' });
if (error) die(`clients upsert failed: ${error.message} — did you run sql/017_answer_desk.sql?`);
console.log(`  clients row ${existing ? 'updated' : 'created'}`);

// ── 6. Go-live checklist ─────────────────────────────────────────────────────
console.log(`
✅  ${cfg.business_name} is set up.

   AI line:          ${prettyPhone(number)}
   Dashboard:        ${BASE_URL}  (password: ${password}${existing ? ' — unchanged' : ' — send it to the owner'})
   Summaries go to:  ${prettyPhone(cfg.owner_phone)}
   Transfers go to:  ${cfg.transfer_phone ? prettyPhone(cfg.transfer_phone) : '(none — no live transfer)'}

NEXT STEPS
 1. Texting: make sure ${prettyPhone(number)} is on your approved A2P 10DLC campaign
    (Twilio console → Messaging → Regulatory compliance). Calls work now; texts
    to customers can be filtered until it's approved.
 2. Forward the owner's business line to the AI line on no-answer/busy. From
    that phone (codes vary by carrier — confirm with theirs):
      Verizon:   *71 ${number.replace('+1', '')}      (no-answer/busy)
      AT&T:      *004*${number.replace('+1', '')}#     (no-answer/busy/unreachable)
      T-Mobile:  **61*${number}#   (no-answer)  and  **67*${number}#  (busy)
    Office VoIP / landline: set "forward on no answer" to ${prettyPhone(number)} in its portal.
 3. Test calls (from a phone that ISN'T the owner's):
    □ Normal call → book a visit → owner gets a summary text, booking shows in the dashboard
    □ Emergency ("no AC, 115 out, my mom's here") → owner gets the 🚨 text right away
    □ Ask for ${cfg.owner_name} → live transfer${cfg.transfer_phone ? '' : ' (not configured)'}
    □ Hang up after the greeting → you get the "sorry we missed you" text in ~1 minute
    □ Reply STOP to that text → no further texts
    □ Flip the dashboard switch OFF → calls ring ${prettyPhone(fallback.number)} directly; flip it back ON
`);
