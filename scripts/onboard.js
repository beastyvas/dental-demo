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

const { validateConfig, previewClient, provisionClient, forwardingCodes } = await import('../lib/provision.js');
const { prettyPhone } = await import('../lib/phone.js');

const args   = process.argv.slice(2);
const slug   = args.find((a) => !a.startsWith('--'));
const DRY    = args.includes('--dry-run');
const BUY    = args.includes('--buy-number');

const die = (msg) => { console.error(`\n❌  ${msg}\n`); process.exit(1); };

// ── 1. Config ────────────────────────────────────────────────────────────────
if (!slug) die('Usage: node scripts/onboard.js <slug> [--dry-run] [--buy-number]');
const cfgPath = resolve(ROOT, 'clients', `${slug}.json`);
if (!existsSync(cfgPath)) die(`No config at clients/${slug}.json — copy clients/example.json to start.`);
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

const problems = validateConfig(cfg, { buyNumber: BUY || DRY });
if (cfg.slug && cfg.slug !== slug && slug !== 'example') problems.push(`"slug" in the file (${cfg.slug}) doesn't match the file name (${slug})`);
if (problems.length) die(`clients/${slug}.json:\n   - ${problems.join('\n   - ')}`);

if (DRY) {
  const { firstMessage, systemPrompt } = previewClient(cfg);
  console.log(`\n── First message ──\n${firstMessage}\n\n── System prompt (${systemPrompt.length} chars) ──\n${systemPrompt}`);
  console.log('── Dry run: nothing was created. ──\n');
  process.exit(0);
}

// ── 2–5. Assistant, number, Vapi import, DB row ─────────────────────────────
if (!process.env.DEPLOYMENT_URL) die('Missing env var: DEPLOYMENT_URL');
const BASE_URL = process.env.DEPLOYMENT_URL.replace(/\/$/, '');
let result;
try {
  result = await provisionClient(cfg, { buyNumber: BUY, baseUrl: BASE_URL, log: (m) => console.log(`  ${m}`) });
} catch (err) {
  die(err.message);
}
const { client, password, isNew, number, fallbackNumber } = result;
const owner = client.owner_phone;
const transfer = client.transfer_phone;

// ── 6. Go-live checklist ─────────────────────────────────────────────────────
const codes = forwardingCodes(number).map((c) => `      ${(c.carrier + ':').padEnd(10)} ${c.code}   (${c.note})`).join('\n');
console.log(`
✅  ${client.business_name} is set up.

   AI line:          ${prettyPhone(number)}
   Dashboard:        ${BASE_URL}  (password: ${password}${isNew ? ' — send it to the owner' : ' — unchanged'})
   Summaries go to:  ${prettyPhone(owner)}
   Transfers go to:  ${transfer ? prettyPhone(transfer) : '(none — no live transfer)'}

NEXT STEPS
 1. Texting: make sure ${prettyPhone(number)} is on your approved A2P 10DLC campaign
    (Twilio console → Messaging → Regulatory compliance, or the CRM's "Attach to
    A2P" button when TWILIO_MESSAGING_SERVICE_SID is set). Calls work now; texts
    to customers can be filtered until it's approved.
 2. Forward the owner's business line to the AI line on no-answer/busy. From
    that phone (codes vary by carrier — confirm with theirs):
${codes}
    Office VoIP / landline: set "forward on no answer" to ${prettyPhone(number)} in its portal.
 3. Test calls (from a phone that ISN'T the owner's):
    □ Normal call → book a visit → owner gets a summary text, booking shows in the dashboard
    □ Emergency ("no AC, 115 out, my mom's here") → owner gets the 🚨 text right away
    □ Ask for ${cfg.owner_name} → live transfer${transfer ? '' : ' (not configured)'}
    □ Hang up after the greeting → you get the "sorry we missed you" text in ~1 minute
    □ Reply STOP to that text → no further texts
    □ Flip the dashboard switch OFF → calls ring ${prettyPhone(fallbackNumber)} directly; flip it back ON
`);
