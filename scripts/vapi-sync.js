/**
 * scripts/vapi-sync.js
 * Pushes the system prompt, first message, and all tools to a Vapi assistant in one shot.
 *
 * Usage:
 *   node scripts/vapi-sync.js massage-envy
 *   node scripts/vapi-sync.js hammond-dental    (coming soon)
 *
 * Requires env vars (set in .env.local or via Vercel):
 *   VAPI_API_KEY          — your Vapi private key
 *   VAPI_WEBHOOK_SECRET   — the shared secret for tool call verification
 *   DEPLOYMENT_URL        — your Vercel URL, e.g. https://receptionist-demo.vercel.app
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

// ── Load .env.local without requiring dotenv ──────────────────────────────────
function loadEnv() {
  try {
    const content = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // .env.local is optional — Vercel injects env vars at runtime
  }
}

loadEnv();

// ── Config ────────────────────────────────────────────────────────────────────
const VAPI_KEY       = process.env.VAPI_API_KEY;
const WEBHOOK_SECRET = process.env.VAPI_WEBHOOK_SECRET;

if (!VAPI_KEY)       { console.error('❌  Missing VAPI_API_KEY'); process.exit(1); }
if (!WEBHOOK_SECRET) { console.error('❌  Missing VAPI_WEBHOOK_SECRET'); process.exit(1); }

// ── Assistant registry ────────────────────────────────────────────────────────
const ASSISTANTS = {
  'massage-envy': {
    id:           '4235062a-715a-49fe-a72f-9ef83c915b35',
    promptFile:   'vapi/massage-envy-centennial-prompt.md',
    firstMessage: 'Thank you for calling Massage Envy Centennial Gateway, this is Ava! Are you looking to book an appointment, or is there something else I can help you with today?',
    tools: [
      'meevo-availability-tool',
      'meevo-book-tool',
      'meevo-new-member-tool',
      'emergency-tool',
    ],
  },
  'maintenance-america': {
    id:           '2016b703-41c0-4b5d-8505-5bc5bcf17cf3',
    promptFile:   'vapi/prompts/maintenance-america-prompt.md',
    firstMessage: 'Thank you for calling Maintenance America. This is Arianna, your scheduling assistant. How may I help you today?',
    tools: [
      'office-status-tool',
      'calendar-book-tool',
      'waitlist-tool',
      'emergency-tool',
    ],
  },
  'demo': {
    id:           '73ce919c-a2f9-420e-bb7f-323a79fdac69',
    promptFile:   'vapi/prompts/demo-agent-prompt.md',
    firstMessage: 'Hi there! Thanks for calling — for this demo, what type of business should I be the receptionist for today?',
    tools: [
      'office-status-tool',
      'calendar-book-tool',
      'waitlist-tool',
      'emergency-tool',
    ],
  },
  // 'hammond-dental': { ... }  ← add more clients here
};

// ── Tool builder ──────────────────────────────────────────────────────────────
function loadTool(name, baseUrl) {
  const raw  = readFileSync(resolve(ROOT, 'vapi/tools', `${name}.json`), 'utf8');
  const tool = JSON.parse(raw);

  if (tool.server?.url) {
    tool.server.url = tool.server.url.replace('https://YOUR_VERCEL_DOMAIN.vercel.app', baseUrl);
  }
  if (tool.server?.headers?.['x-vapi-secret'] === '{{VAPI_WEBHOOK_SECRET}}') {
    tool.server.headers['x-vapi-secret'] = WEBHOOK_SECRET;
  }

  return tool;
}

// ── Vapi GET + PATCH ──────────────────────────────────────────────────────────
async function fetchAssistant(id) {
  const r = await fetch(`https://api.vapi.ai/assistant/${id}`, {
    headers: { Authorization: `Bearer ${VAPI_KEY}` },
  });
  if (!r.ok) throw new Error(`Vapi GET failed (${r.status}): ${await r.text()}`);
  return r.json();
}

async function updateAssistant(id, body) {
  const r = await fetch(`https://api.vapi.ai/assistant/${id}`, {
    method:  'PATCH',
    headers: {
      Authorization:  `Bearer ${VAPI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Vapi PATCH failed (${r.status}): ${text}`);
  }
  return r.json();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const target = process.argv[2];
  const urlArg = process.argv[3];

  if (urlArg) process.env.DEPLOYMENT_URL = urlArg.replace(/\/$/, '');

  const BASE_URL = (process.env.DEPLOYMENT_URL || '').replace(/\/$/, '');

  if (!target || !ASSISTANTS[target]) {
    console.error(`Usage: node scripts/vapi-sync.js <assistant> [deployment-url]`);
    console.error(`Available: ${Object.keys(ASSISTANTS).join(', ')}`);
    process.exit(1);
  }

  if (!BASE_URL) { console.error('❌  Missing DEPLOYMENT_URL'); process.exit(1); }

  const config = ASSISTANTS[target];

  console.log(`\n🔄  Syncing "${target}" (${config.id})...`);
  console.log(`    URL:  ${BASE_URL}`);

  // System prompt
  const systemPrompt = readFileSync(resolve(ROOT, config.promptFile), 'utf8');
  console.log(`    Prompt: ${config.promptFile} (${systemPrompt.length} chars)`);

  // Tools
  const tools = config.tools.map(name => loadTool(name, BASE_URL));
  console.log(`    Tools: ${config.tools.join(', ')}`);

  // Fetch current assistant so we preserve provider/model/temperature/etc.
  console.log(`    Fetching current assistant config...`);
  const current = await fetchAssistant(config.id);

  // Push to Vapi — merge into existing model object + tune call behavior
  const updated = await updateAssistant(config.id, {
    firstMessage: config.firstMessage,
    backgroundDenoisingEnabled: true,   // filter out background noise
    numWordsToInterruptAssistant: 3,    // caller must say 3 words before interrupting
    silenceTimeoutSeconds: 20,          // wait 20s of silence before ending call
    responseDelaySeconds: 0.5,          // small pause before Ava responds (feels natural)
    model: {
      ...current.model,
      messages: [{ role: 'system', content: systemPrompt }],
      tools,
    },
  });

  console.log(`\n✅  Done! Assistant updated: ${updated.id}`);
  console.log(`    Name: ${updated.name ?? '(unnamed)'}`);
  console.log(`    Tools registered: ${updated.model?.tools?.length ?? 0}`);
}

main().catch(err => {
  console.error('\n❌  Error:', err.message);
  process.exit(1);
});
