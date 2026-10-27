/**
 * What a lead status change kicks off. Called by setLeadStatus (lib/leads.js)
 * after the status is saved. Returns short notes ("5 follow-up texts
 * scheduled") for the dashboard to show.
 */

import { schedule, cancelPending } from './followups.js';
import { automationFor, templateVars, render } from './automation.js';

const DAY_MS = 86_400_000;

async function startEstimateFollowup(client, lead, now) {
  if (!lead.phone) return 'No phone on this lead — no follow-up texts';
  const auto = automationFor(client);
  await cancelPending({ clientId: client.id, leadId: lead.id, kinds: ['estimate'] });
  const vars = templateVars(client, lead);
  const items = auto.estimate_days.map((days, i) => ({
    sendAt: new Date(now.getTime() + days * DAY_MS),
    body: render(auto.estimate_templates[i] ?? auto.estimate_templates.at(-1), vars),
    step: i + 1,
  }));
  await schedule(client, lead, 'estimate', items);
  return `${items.length} follow-up texts scheduled over ${auto.estimate_days.at(-1)} days — they stop when ${vars.first_name || 'the customer'} replies`;
}

export async function runStatusAutomations(client, lead, { prev, now }) {
  const notes = [];
  if (lead.status === 'estimate_sent') {
    notes.push(await startEstimateFollowup(client, lead, now));
  } else if (prev === 'estimate_sent') {
    const n = await cancelPending({ clientId: client.id, leadId: lead.id, kinds: ['estimate'] });
    if (n) notes.push(`Stopped ${n} follow-up text${n === 1 ? '' : 's'}`);
  }
  if (lead.status === 'won' || lead.status === 'lost') {
    await cancelPending({ clientId: client.id, leadId: lead.id, kinds: ['estimate', 'reactivation'] });
  }
  return notes;
}
