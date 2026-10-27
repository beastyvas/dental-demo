/**
 * Per-client automation settings (clients.automation), merged over these
 * defaults. The CRM edits them; everything that texts a lead reads them here.
 *
 * Templates use {first_name} {business} {agent} {owner} {ai_line} {service}
 * {when}. Missing values collapse cleanly ("Hi there," instead of "Hi ,").
 */

import { prettyPhone } from './phone.js';

export const DEFAULTS = {
  // Speed-to-lead
  speed_text: true,
  speed_call: false, // AI calls the lead back — off by default (AI-voice consent rules)
  owner_alert: true,
  speed_template: "Hi {first_name}, this is {agent} with {business}. We got your request{about} — what's a good time for a quick call? Or call/text us here anytime.",

  // Estimate follow-up: day offsets after "estimate sent", one template each.
  estimate_days: [2, 5, 9, 14, 21],
  estimate_templates: [
    "Hi {first_name}, it's {owner} with {business}. Just checking you got the estimate okay — any questions I can answer?",
    "Hi {first_name}, {owner} here. Happy to walk through the estimate on a quick call if that helps. What works for you?",
    "Hey {first_name}, wanted to see where you landed on the project. If timing or price is the hang-up, let me know — there may be options.",
    "Hi {first_name}, {owner} with {business}. Our schedule is filling up for the next few weeks — want me to hold a spot for you?",
    "Hi {first_name}, last check-in from me on the estimate. If you went another way, no hard feelings — just reply and I'll close it out.",
  ],

  // Appointment reminders: minutes before the appointment.
  reminder_offsets_min: [1440, 120],
  reminder_template: "Hi {first_name}, reminder from {business}: your {service} appointment is {when}. Need to reschedule? Just reply here.",

  // Review requests after a job is marked done.
  review_delay_min: 60,

  // Reactivation campaigns
  reactivation_template: "Hi {first_name}, it's {owner} with {business}. It's been a while since your {service} — want us to take a look before the busy season? Reply YES and we'll set it up.",
  reactivation_per_hour: 60,

  // Quiet hours for scheduled texts, in the client's timezone (24h clock).
  quiet_start: 20,
  quiet_end: 8,

  // Monthly scorecard: average job value used for "revenue recovered".
  avg_job_value: 450,
};

export function automationFor(client) {
  return { ...DEFAULTS, ...(client?.automation ?? {}) };
}

export const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0] || '';

export function templateVars(client, lead = {}, extra = {}) {
  return {
    first_name: firstName(lead.name),
    business: client.business_name,
    agent: client.agent_name || client.config?.agent_name || 'the team',
    owner: client.config?.owner_name || client.config?.contact_name?.split(' ')[0] || client.business_name,
    ai_line: client.twilio_number ? prettyPhone(client.twilio_number) : '',
    service: lead.service || '',
    about: lead.message ? ` about ${String(lead.message).slice(0, 60).replace(/[.!?\s]+$/, '')}` : '',
    when: '',
    ...extra,
  };
}

/** Fill {vars}; tidy the gaps a missing value leaves ("Hi ," → "Hi there,"). */
export function render(template, vars) {
  return String(template ?? '')
    .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m))
    .replace(/^(Hi|Hey|Hello) ,/, '$1 there,')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim();
}
