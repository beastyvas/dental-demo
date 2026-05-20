#!/usr/bin/env node
/**
 * scripts/vapi-setup.js
 * ---------------------
 * Pushes a client's system prompt + tools to their Vapi agent.
 *
 * Usage:
 *   node scripts/vapi-setup.js                    # uses VAPI_AGENT_ID env var (legacy)
 *   node scripts/vapi-setup.js --client hammond-dental   # looks up agent ID from DB
 *
 * Required env vars:
 *   VAPI_API_KEY         — from Vapi dashboard → API Keys
 *   VERCEL_DOMAIN        — e.g. dental-demo-vn2d.vercel.app  (no https://)
 *   VAPI_WEBHOOK_SECRET  — shared secret set in Vercel env vars
 *
 * When using --client flag, also required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath }   from 'url';
import { dirname, resolve } from 'path';
import { getAssistant, updateAssistant } from '../lib/vapi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root      = resolve(__dirname, '..');

// ── Load .env.local if present ──────────────────────────────────────────────
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

// ── Parse CLI args ───────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const clientIndex = args.indexOf('--client');
const clientSlug  = clientIndex !== -1 ? args[clientIndex + 1] : null;

const DOMAIN  = process.env.VERCEL_DOMAIN;
const SECRET  = process.env.VAPI_WEBHOOK_SECRET;

if (!DOMAIN)  { console.error('❌  VERCEL_DOMAIN is not set');        process.exit(1); }
if (!SECRET)  { console.error('❌  VAPI_WEBHOOK_SECRET is not set');   process.exit(1); }

// ── Resolve agent ID ─────────────────────────────────────────────────────────
async function resolveAgentId(slug) {
  if (!slug) {
    const id = process.env.VAPI_AGENT_ID;
    if (!id) { console.error('❌  Provide --client <slug> or set VAPI_AGENT_ID'); process.exit(1); }
    return id;
  }

  // Look up from Supabase
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data, error } = await sb
    .from('clients')
    .select('agent_id, business_name')
    .eq('slug', slug)
    .single();

  if (error || !data) {
    console.error(`❌  Client "${slug}" not found in Supabase`);
    process.exit(1);
  }

  console.log(`   Client   : ${data.business_name} (${slug})`);
  return data.agent_id;
}

// ── Read system prompt ────────────────────────────────────────────────────────
function resolvePromptFile(slug) {
  if (slug) {
    const custom = resolve(root, 'vapi/prompts', `${slug}-system-prompt.md`);
    if (existsSync(custom)) return custom;
    console.warn(`   ⚠️  No prompt file for "${slug}" — falling back to rachel-system-prompt.md`);
  }
  return resolve(root, 'vapi/prompts/rachel-system-prompt.md');
}

function loadSystemPrompt(promptPath) {
  const raw         = readFileSync(promptPath, 'utf8');
  const startMarker = '# ===START===';
  const idx         = raw.indexOf(startMarker);
  if (idx === -1) {
    console.error('❌  Could not find # ===START=== marker in system prompt file');
    process.exit(1);
  }
  return raw.slice(idx + startMarker.length).trim();
}

// ── Build tool definitions ────────────────────────────────────────────────────
function loadTool(filename) {
  const raw  = readFileSync(resolve(root, 'vapi/tools', filename), 'utf8');
  const tool = JSON.parse(raw);
  if (tool.server?.url) {
    tool.server.url = tool.server.url.replace('YOUR_VERCEL_DOMAIN.vercel.app', DOMAIN);
  }
  if (tool.server?.headers?.['x-vapi-secret']) {
    tool.server.headers['x-vapi-secret'] = SECRET;
  }
  return tool;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n🦷  Vapi Setup');
  console.log(`   Domain   : ${DOMAIN}`);
  if (clientSlug) console.log(`   Mode     : client lookup (--client ${clientSlug})`);
  else            console.log('   Mode     : env var (VAPI_AGENT_ID)');
  console.log('');

  const agentId      = await resolveAgentId(clientSlug);
  const promptPath   = resolvePromptFile(clientSlug);
  const systemPrompt = loadSystemPrompt(promptPath);

  const tools = [
    loadTool('office-status-tool.json'),
    loadTool('waitlist-tool.json'),
    loadTool('emergency-tool.json'),
  ];

  console.log(`   Agent ID : ${agentId}`);
  console.log(`   Prompt   : ${promptPath.replace(root, '.')}`);
  console.log('');

  console.log('📡  Fetching current assistant config…');
  const current      = await getAssistant(agentId);
  const currentModel = current.model ?? {};

  console.log(`   Model    : ${currentModel.provider ?? '?'} / ${currentModel.model ?? '?'}`);
  console.log(`   Tools    : ${(currentModel.tools ?? []).length} currently → replacing with ${tools.length}`);
  console.log('');

  const update = {
    model: {
      ...(currentModel.provider    && { provider:    currentModel.provider }),
      ...(currentModel.model       && { model:       currentModel.model }),
      ...(currentModel.temperature !== undefined && { temperature: currentModel.temperature }),
      systemPrompt,
      tools,
    },
  };

  console.log('📤  Pushing system prompt + 3 tools to agent…');
  const result = await updateAssistant(agentId, update);

  console.log('✅  Done!\n');
  console.log(`   System prompt length : ${systemPrompt.length} chars`);
  console.log(`   Tools pushed         : ${result.model?.tools?.length ?? '?'}`);
  tools.forEach(t => console.log(`     • ${t.function.name} → ${t.server?.url}`));
  console.log('');
  console.log('Next: call the Vapi number to verify the agent greets correctly.');
}

run().catch(err => {
  console.error('\n❌  Setup failed:', err.message);
  process.exit(1);
});
