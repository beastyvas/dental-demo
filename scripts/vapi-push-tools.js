#!/usr/bin/env node
/**
 * scripts/vapi-push-tools.js
 * ---------------------------
 * Pushes ONLY the standard tool set (office-status, calendar-book, waitlist,
 * emergency) to a Vapi assistant, preserving whatever system prompt /
 * messages are already configured on the assistant. Use this when the
 * prompt was written directly in the Vapi dashboard and shouldn't be
 * overwritten by a local prompt file.
 *
 * Usage:
 *   node scripts/vapi-push-tools.js <agent-id>
 *
 * Required env vars (loaded from .env.local if present):
 *   VAPI_API_KEY
 *   VAPI_WEBHOOK_SECRET
 *   VERCEL_DOMAIN   (no https://)
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getAssistant, updateAssistant } from '../lib/vapi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

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
} catch { /* .env.local is optional */ }

const agentId = process.argv[2];
const DOMAIN  = process.env.VERCEL_DOMAIN;
const SECRET  = process.env.VAPI_WEBHOOK_SECRET;

if (!agentId) { console.error('Usage: node scripts/vapi-push-tools.js <agent-id>'); process.exit(1); }
if (!DOMAIN)  { console.error('Missing VERCEL_DOMAIN');       process.exit(1); }
if (!SECRET)  { console.error('Missing VAPI_WEBHOOK_SECRET'); process.exit(1); }

function loadTool(filename) {
  const raw  = readFileSync(resolve(ROOT, 'vapi/tools', filename), 'utf8');
  const tool = JSON.parse(raw);
  if (tool.server?.url) {
    tool.server.url = tool.server.url.replace('YOUR_VERCEL_DOMAIN.vercel.app', DOMAIN);
  }
  if (tool.server?.headers?.['x-vapi-secret']) {
    tool.server.headers['x-vapi-secret'] = SECRET;
  }
  return tool;
}

async function run() {
  const tools = [
    loadTool('office-status-tool.json'),
    loadTool('calendar-book-tool.json'),
    loadTool('waitlist-tool.json'),
    loadTool('emergency-tool.json'),
  ];

  console.log(`\nFetching current assistant ${agentId}...`);
  const current = await getAssistant(agentId);
  console.log(`   Name     : ${current.name ?? '(unnamed)'}`);
  console.log(`   Model    : ${current.model?.provider ?? '?'} / ${current.model?.model ?? '?'}`);
  console.log(`   Prompt   : ${current.model?.messages?.length ?? 0} message(s) already set — left untouched`);
  console.log(`   Tools    : ${(current.model?.tools ?? []).length} currently -> replacing with ${tools.length}`);

  const update = {
    model: {
      ...current.model,
      tools,
    },
  };

  console.log('\nPushing tools (prompt preserved)...');
  const result = await updateAssistant(agentId, update);

  console.log('\nDone.');
  console.log(`   Tools registered: ${result.model?.tools?.length ?? '?'}`);
  (result.model?.tools ?? []).forEach(t => console.log(`     - ${t.function?.name} -> ${t.server?.url}`));
}

run().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
