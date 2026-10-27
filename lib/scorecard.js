/**
 * The monthly "revenue recovered" scorecard — what the system did for a
 * business in a month, from numbers we actually record:
 * calls answered (after-hours separately), leads by source, speed-to-lead,
 * estimate follow-ups and the replies they got, bookings, review requests and
 * ratings. "Estimated value" = jobs booked or won × the business's average
 * job value (automation.avg_job_value), and it's labeled as an estimate.
 */

import { supabase } from './supabase.js';
import { zonedToUtcMs } from './slots.js';
import { automationFor } from './automation.js';
import { SOURCE_LABEL } from './leads.js';

/** [start, end) of a calendar month in the business's timezone. month = 'YYYY-MM'. */
export function monthRange(month, tz) {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { from: new Date(zonedToUtcMs(`${month}-01`, 0, 0, tz)), to: new Date(zonedToUtcMs(`${next}-01`, 0, 0, tz)) };
}

export function previousMonth(now, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit' })
    .formatToParts(now).map((p) => [p.type, p.value]));
  const y = Number(parts.year);
  const m = Number(parts.month);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

export async function computeScorecard(client, month) {
  const tz = client.timezone || 'America/Los_Angeles';
  const { from, to } = monthRange(month, tz);
  const [f, t] = [from.toISOString(), to.toISOString()];
  const [calls, leads, estimates, reviews] = await Promise.all([
    supabase.from('calls').select('outcome, after_hours, started_at').eq('client_id', client.id).gte('started_at', f).lte('started_at', t),
    supabase.from('client_leads').select('id, source, status, received_at, first_response_at').eq('client_id', client.id).gte('received_at', f).lte('received_at', t),
    supabase.from('followups').select('lead_id, status, sent_at').eq('client_id', client.id).eq('kind', 'estimate').eq('status', 'sent').gte('sent_at', f).lte('sent_at', t),
    supabase.from('review_requests').select('rating, sent_at').eq('client_id', client.id).gte('sent_at', f).lte('sent_at', t),
  ]);
  const c = (calls.data ?? []).filter((x) => x.started_at < t && x.outcome !== 'spam');
  const l = (leads.data ?? []).filter((x) => x.received_at < t);
  const est = (estimates.data ?? []).filter((x) => x.sent_at < t);
  const rv = (reviews.data ?? []).filter((x) => x.sent_at < t);

  const outside = l.filter((x) => x.source !== 'call');
  const secs = outside.filter((x) => x.first_response_at)
    .map((x) => Math.max(0, (new Date(x.first_response_at) - new Date(x.received_at)) / 1000));
  const estLeadIds = new Set(est.map((x) => x.lead_id).filter(Boolean));
  const { data: estLeads } = estLeadIds.size
    ? await supabase.from('client_leads').select('id, status').in('id', [...estLeadIds])
    : { data: [] };
  const rated = rv.filter((x) => x.rating != null);
  const bookedCalls = c.filter((x) => x.outcome === 'booked').length;
  const bookedLeads = l.filter((x) => x.source !== 'call' && ['booked', 'job_done', 'won'].includes(x.status)).length;
  const avgJob = Number(automationFor(client).avg_job_value) || 0;

  const bySource = {};
  for (const x of l) bySource[x.source] = (bySource[x.source] ?? 0) + 1;

  return {
    month,
    callsAnswered: c.length,
    afterHours: c.filter((x) => x.after_hours).length,
    leads: l.length,
    bySource,
    medianResponseSeconds: median(secs),
    answeredUnder5min: secs.filter((s) => s <= 300).length,
    outsideLeads: outside.length,
    estimateTextsSent: est.length,
    estimateLeadsFollowedUp: estLeadIds.size,
    estimateReplies: (estLeads ?? []).filter((x) => ['replied', 'booked', 'job_done', 'won'].includes(x.status)).length,
    booked: bookedCalls + bookedLeads,
    reviewRequests: rv.length,
    reviewsRated: rated.length,
    avgRating: rated.length ? Math.round((rated.reduce((s, x) => s + x.rating, 0) / rated.length) * 10) / 10 : null,
    avgJobValue: avgJob,
    estimatedValue: (bookedCalls + bookedLeads) * avgJob,
  };
}

const MONTH_NAME = (month) => new Date(`${month}-15T12:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
const fmtSecs = (s) => (s == null ? null : s < 60 ? `${Math.round(s)}s` : `${Math.round(s / 60)} min`);
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

export function scorecardText(client, sc, dashboardUrl) {
  const sources = Object.entries(sc.bySource).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${SOURCE_LABEL[k] ?? k} ${v}`).join(', ');
  const lines = [
    `📊 ${client.business_name} — ${MONTH_NAME(sc.month)}`,
    `${sc.callsAnswered} calls answered${sc.afterHours ? ` (${sc.afterHours} after hours)` : ''}`,
    `${sc.leads} leads${sources ? `: ${sources}` : ''}`,
    sc.outsideLeads ? `Typical response to new leads: ${fmtSecs(sc.medianResponseSeconds) ?? '—'} (${sc.answeredUnder5min}/${sc.outsideLeads} within 5 min)` : null,
    `${sc.booked} jobs booked`,
    sc.estimateLeadsFollowedUp ? `${sc.estimateLeadsFollowedUp} estimates followed up → ${sc.estimateReplies} replied` : null,
    sc.reviewRequests ? `${sc.reviewRequests} review requests${sc.avgRating ? ` (avg ${sc.avgRating}★)` : ''}` : null,
    sc.estimatedValue ? `Est. value: ~${money(sc.estimatedValue)} (at ${money(sc.avgJobValue)}/job)` : null,
    dashboardUrl ? `Details: ${dashboardUrl}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}
