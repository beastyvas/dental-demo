/**
 * Builds a client's system prompt + first message from vapi/templates/base.md
 * and vapi/trades/<trade>.json. Pure (reads files only) — used by
 * scripts/onboard.js and the tests.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeHours } from './businessHours.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const TRADES = readdirSync(resolve(ROOT, 'vapi/trades'))
  .filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));

export const loadTrade = (trade) => {
  if (!TRADES.includes(trade)) throw new Error(`Unknown trade "${trade}". Available: ${TRADES.join(', ')}`);
  return JSON.parse(readFileSync(resolve(ROOT, 'vapi/trades', `${trade}.json`), 'utf8'));
};

/** Nevada is all-party consent for recording, and the FCC treats AI voices as artificial — so every call opens with both disclosures. */
export function renderFirstMessage(cfg) {
  return `Thanks for calling ${cfg.business_name}, this is ${cfg.agent_name}, an AI assistant — this call may be recorded. How can I help you today?`;
}

const bullets = (arr) => (arr ?? []).map((s) => (s.startsWith('- ') ? s : `- ${s}`)).join('\n');

function fill(text, vars) {
  // Two passes so values that themselves contain {{owner_name}} (trade files) resolve too.
  let out = text;
  for (let i = 0; i < 2; i++) out = out.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

export function renderPrompt(cfg) {
  const trade = loadTrade(cfg.trade);
  const owner = cfg.owner_name || 'the owner';
  const hasTransfer = Boolean(cfg.transfer_phone);

  const pricingOrOwner = cfg.service_fee
    ? `it's ${cfg.service_fee}.`
    : `${owner} will go over pricing on the callback.`;

  const vars = {
    business_name:  cfg.business_name,
    agent_name:     cfg.agent_name,
    owner_name:     owner,
    trade_label:    trade.trade_label,
    service_area:   cfg.service_area || 'the Las Vegas valley',
    hours:          describeHours(cfg.business_hours ?? null),
    business_facts: bullets(cfg.business_facts),
    services:       bullets([...(trade.services ?? []), ...(cfg.extra_services ?? [])]),
    emergency_triggers: bullets(trade.emergency_triggers),
    safety_line:    trade.safety_line ?? '',
    triage_questions: (trade.triage_questions ?? []).join('\n'),
    visit_type:     cfg.visit_type || trade.visit_type,
    visit_minutes:  cfg.visit_minutes || trade.visit_minutes || 60,
    callback_promise: cfg.callback_promise || trade.callback_promise || 'within one business day',
    pricing_or_owner: pricingOrOwner,
    pricing_policy: cfg.pricing_policy
      || `Don't quote job prices — every job is different. Say: "${owner} will give you an exact price once we've seen it."${cfg.service_fee ? ` If they ask about the service call fee, it's ${cfg.service_fee}.` : ''}`,
    faq:            bullets([...(trade.faq ?? []), ...(cfg.extra_faq ?? [])]),
    transfer_step:  hasTransfer
      ? `3. If they want to talk to someone right now, offer to connect them and use **transferCall**. If it doesn't connect, keep going with step 4.`
      : `3. (Live transfer isn't set up — the text alert is how ${owner} finds out.)`,
    transfer_policy: hasTransfer
      ? `If a caller asks for ${owner} by name, is an existing customer with a job in progress, or is upset and wants a person, say "Let me connect you" and use **transferCall**. If the transfer doesn't go through, take a message with addToWaitlist.`
      : `You can't transfer calls. If someone wants ${owner}, take a message with addToWaitlist and say ${owner} will call them back.`,
    first_message:  renderFirstMessage(cfg),
    extra_rules:    bullets(cfg.extra_rules),
  };

  const template = readFileSync(resolve(ROOT, 'vapi/templates/base.md'), 'utf8');
  return fill(template, vars).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
