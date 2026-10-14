/**
 * Pure call logic for the end-of-call webhook — no I/O, so it's unit-testable.
 *
 *   classifyCall()      → what happened on the call (the dashboard badge + guarantee counter)
 *   shouldTextBack()    → whether the caller gets a missed-call text
 *   ownerSummaryText()  → the text the owner gets after the call
 *   textBackText()      → the text the caller gets when we lost them
 */

import { prettyPhone } from './phone.js';

// endedReasons that are a normal end of a call, not a failure.
const NORMAL_ENDS = new Set([
  'customer-ended-call',
  'assistant-ended-call',
  'assistant-said-end-call-phrase',
  'assistant-forwarded-call',
  'silence-timed-out',
  'exceeded-max-duration',
  'voicemail',
  'manually-canceled',
  'customer-did-not-answer',
  'customer-busy',
]);

export const isErrorEnd = (reason) =>
  Boolean(reason) && !NORMAL_ENDS.has(reason) && /error|fail|fault|crash|timeout|unavailable/i.test(reason);

/** Names of every tool the assistant called during the call. */
export function toolNamesFromArtifact(artifact) {
  const names = new Set();
  for (const m of artifact?.messages ?? []) {
    for (const tc of m.toolCalls ?? m.tool_calls ?? []) {
      const n = tc.function?.name ?? tc.name;
      if (n) names.add(n);
    }
  }
  return names;
}

/**
 * @param {object} p
 * @param {string}   p.endedReason
 * @param {number}   p.durationSeconds
 * @param {object[]} p.leads       waitlist rows created during this call (by vapi_call_id)
 * @param {Set}      p.tools       tool names called (toolNamesFromArtifact)
 * @param {object}   p.structured  analysis.structuredData
 * @param {number}   p.transfers   artifact.transfers.length
 * @returns {'booked'|'emergency'|'lead'|'transferred'|'spam'|'error'|'hangup'|'info'}
 */
export function classifyCall({ endedReason, durationSeconds = 0, leads = [], tools = new Set(), structured = {}, transfers = 0 }) {
  const booked = leads.some((l) => /^BOOKED/i.test(l.notes ?? '')) || tools.has('bookAppointment');
  if (tools.has('sendEmergencyAlert')) return 'emergency';
  if (booked) return 'booked';
  if (leads.length) return 'lead';
  if (transfers > 0 || endedReason === 'assistant-forwarded-call' || tools.has('transferCall')) return 'transferred';
  if (structured?.is_spam === true) return 'spam';
  if (isErrorEnd(endedReason)) return 'error';
  if (endedReason === 'customer-ended-call' && durationSeconds < 25) return 'hangup';
  if (!structured?.caller_name && !structured?.need && durationSeconds < 25) return 'hangup';
  return 'info';
}

/** Outcomes that count toward the "qualified leads captured" guarantee. */
export const LEAD_OUTCOMES = new Set(['booked', 'emergency', 'lead', 'transferred']);

/**
 * Text the caller back when we lost them: they hung up early or the call
 * errored, and nothing was captured. One text per caller per 24h.
 */
export function shouldTextBack({ outcome, callerPhone, optedOut = false, textedRecently = false }) {
  if (!callerPhone || optedOut || textedRecently) return false;
  return outcome === 'hangup' || outcome === 'error';
}

/** Skip the owner text for robocalls and pocket dials. */
export const shouldNotifyOwner = ({ outcome, durationSeconds = 0 }) =>
  outcome !== 'spam' && !(outcome === 'hangup' && durationSeconds < 5);

const LABEL = {
  booked:      '✅ JOB BOOKED',
  emergency:   '🚨 URGENT CALL',
  lead:        '📝 NEW LEAD',
  transferred: '📲 TRANSFERRED TO YOU',
  error:       '⚠️ CALL DROPPED',
  hangup:      '☎️ MISSED — CALLER HUNG UP',
  info:        '💬 QUESTION ANSWERED',
  spam:        '🚫 SPAM',
};

export function ownerSummaryText({ businessName, outcome, callerName, callerPhone, need, summary, afterHours, textedBack, dashboardUrl }) {
  const lines = [
    `${LABEL[outcome] ?? '📞 CALL'} — ${businessName}${afterHours ? ' (after hours)' : ''}`,
    `${callerName || 'Caller'} · ${prettyPhone(callerPhone) || 'no caller ID'}`,
  ];
  if (need) lines.push(`Needs: ${need}`);
  if (summary) lines.push(summary.length > 280 ? `${summary.slice(0, 277)}…` : summary);
  if (textedBack) lines.push('We texted them back automatically.');
  if (dashboardUrl) lines.push(dashboardUrl);
  return lines.join('\n');
}

export function textBackText({ businessName, callbackNumber }) {
  const back = callbackNumber ? ` or call us back at ${prettyPhone(callbackNumber)}` : '';
  return `Hi, this is ${businessName} — sorry we didn't get to finish your call. What can we help you with? Just reply here${back}. Reply STOP to opt out.`;
}

/** Analysis plan pushed to every assistant: Vapi fills structuredData from the transcript. */
export const ANALYSIS_PLAN = {
  summaryPlan: {
    enabled: true,
    messages: [
      { role: 'system', content: 'Summarize this receptionist call for a busy contractor in 1–2 short sentences: who called, what they need, what was arranged. Plain text, no preamble.' },
      { role: 'user', content: 'Here is the transcript:\n\n{{transcript}}\n\n' },
    ],
  },
  structuredDataPlan: {
    enabled: true,
    schema: {
      type: 'object',
      properties: {
        caller_name:        { type: 'string', description: "Caller's name, if given" },
        need:               { type: 'string', description: 'What the caller needs, in under 10 words (e.g. "AC not cooling", "roof leak in bedroom", "kitchen remodel estimate")' },
        urgency:            { type: 'string', enum: ['emergency', 'urgent', 'routine', 'none'] },
        service_address:    { type: 'string', description: 'Service address, if given' },
        appointment_booked: { type: 'boolean' },
        is_spam:            { type: 'boolean', description: 'True for robocalls, sales pitches to the business, or wrong numbers' },
      },
    },
  },
};
