#!/usr/bin/env node
/**
 * scripts/vapi-setup.js
 * ---------------------
 * One-time (and re-runnable) script that pushes Rachel's full config
 * to the Vapi agent via the REST API. Run this whenever you update
 * the system prompt or tools instead of copy-pasting into the dashboard.
 *
 * Usage:
 *   node scripts/vapi-setup.js
 *
 * Required env vars (in .env.local or exported in shell):
 *   VAPI_API_KEY         — from Vapi dashboard → API Keys
 *   VAPI_AGENT_ID        — 54da6a88-1e1e-4977-a216-1670b689a253
 *   VERCEL_DOMAIN        — e.g. hammond-dental.vercel.app  (no https://)
 *   VAPI_WEBHOOK_SECRET  — the shared secret set in Vercel env vars
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { getAssistant, updateAssistant } from '../lib/vapi.js';

// ── Load .env.local if present ──────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const root      = resolve(__dirname, '..');

try {
  const envPath = resolve(root, '.env.local');
  const lines   = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join('=').trim();
    }
  }
} catch { /* .env.local is optional */ }

// ── Config ──────────────────────────────────────────────────────────────────
const AGENT_ID = process.env.VAPI_AGENT_ID;
const DOMAIN   = process.env.VERCEL_DOMAIN; // e.g. hammond-dental.vercel.app
const SECRET   = process.env.VAPI_WEBHOOK_SECRET;

if (!AGENT_ID) { console.error('❌  VAPI_AGENT_ID is not set'); process.exit(1); }
if (!DOMAIN)   { console.error('❌  VERCEL_DOMAIN is not set (e.g. hammond-dental.vercel.app)'); process.exit(1); }
if (!SECRET)   { console.error('❌  VAPI_WEBHOOK_SECRET is not set'); process.exit(1); }

// ── Read system prompt ───────────────────────────────────────────────────────
const promptFile = readFileSync(
  resolve(root, 'vapi/prompts/rachel-system-prompt.md'),
  'utf8'
);
const startMarker  = '# ===START===';
const markerIndex  = promptFile.indexOf(startMarker);
if (markerIndex === -1) {
  console.error('❌  Could not find # ===START=== marker in rachel-system-prompt.md');
  process.exit(1);
}
const systemPrompt = promptFile.slice(markerIndex + startMarker.length).trim();

// ── Build tool definitions ───────────────────────────────────────────────────
function loadTool(filename) {
  const raw  = readFileSync(resolve(root, 'vapi/tools', filename), 'utf8');
  const tool = JSON.parse(raw);

  // Replace placeholder domain with the real one
  if (tool.server?.url) {
    tool.server.url = tool.server.url.replace('YOUR_VERCEL_DOMAIN.vercel.app', DOMAIN);
  }
  // Replace placeholder secret with the real one
  if (tool.server?.headers?.['x-vapi-secret']) {
    tool.server.headers['x-vapi-secret'] = SECRET;
  }
  return tool;
}

const tools = [
  loadTool('office-status-tool.json'),
  loadTool('waitlist-tool.json'),
  loadTool('emergency-tool.json'),
];

// ── Push to Vapi ─────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n🦷  Hammond Dental — Vapi Setup`);
  console.log(`   Agent ID : ${AGENT_ID}`);
  console.log(`   Domain   : ${DOMAIN}`);
  console.log('');

  // Fetch current config so we don't overwrite voice, firstMessage, etc.
  console.log('📡  Fetching current assistant config…');
  const current = await getAssistant(AGENT_ID);
  const currentModel = current.model ?? {};

  console.log(`   Model    : ${currentModel.provider ?? '?'} / ${currentModel.model ?? '?'}`);
  console.log(`   Tools    : ${(currentModel.tools ?? []).length} currently → replacing with ${tools.length}`);
  console.log('');

  const update = {
    model: {
      // Preserve provider/model/temperature — only replace prompt + tools
      ...(currentModel.provider    && { provider:    currentModel.provider }),
      ...(currentModel.model       && { model:       currentModel.model }),
      ...(currentModel.temperature !== undefined && { temperature: currentModel.temperature }),
      systemPrompt,
      tools,
    },
  };

  console.log('📤  Pushing system prompt + 3 tools to agent…');
  const result = await updateAssistant(AGENT_ID, update);

  console.log('✅  Done!\n');
  console.log(`   System prompt length : ${systemPrompt.length} chars`);
  console.log(`   Tools pushed         : ${result.model?.tools?.length ?? '?'}`);
  tools.forEach(t => console.log(`     • ${t.function.name} → ${t.server?.url}`));
  console.log('');
  console.log('Next: call your Vapi number to verify Rachel greets correctly.');
}

run().catch(err => {
  console.error('\n❌  Setup failed:', err.message);
  process.exit(1);
});
