// Run with: node --test --experimental-test-module-mocks test/scorecard.test.js
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './fake-db.js';

const db = createFakeDb({
  clients: [{ id: 'c1', slug: 'desert-air', business_name: 'Desert Air', active: true, status: 'live', plan: 'booked_jobs',
    owner_phone: '+17025550101', twilio_number: '+17025559999', timezone: 'America/Los_Angeles', automation: { avg_job_value: 500 } }],
  calls: [
    { client_id: 'c1', outcome: 'booked', after_hours: true, started_at: '2026-10-05T03:00:00Z' },
    { client_id: 'c1', outcome: 'lead', after_hours: false, started_at: '2026-10-10T18:00:00Z' },
    { client_id: 'c1', outcome: 'spam', after_hours: false, started_at: '2026-10-11T18:00:00Z' },
    { client_id: 'c1', outcome: 'booked', after_hours: false, started_at: '2026-11-01T08:00:00Z' }, // Nov 1 1am PDT → November
    { client_id: 'c1', outcome: 'booked', after_hours: false, started_at: '2026-10-01T06:00:00Z' }, // Sep 30 11pm PDT → September
  ],
  client_leads: [
    { id: 'l1', client_id: 'c1', source: 'angi', status: 'won', received_at: '2026-10-03T17:00:00Z', first_response_at: '2026-10-03T17:00:20Z' },
    { id: 'l2', client_id: 'c1', source: 'form', status: 'replied', received_at: '2026-10-04T17:00:00Z', first_response_at: '2026-10-04T17:10:00Z' },
    { id: 'l3', client_id: 'c1', source: 'call', status: 'booked', received_at: '2026-10-05T03:00:00Z', first_response_at: '2026-10-05T03:00:00Z' },
  ],
  followups: [
    { client_id: 'c1', lead_id: 'l2', kind: 'estimate', status: 'sent', sent_at: '2026-10-06T17:00:00Z' },
    { client_id: 'c1', lead_id: 'l2', kind: 'estimate', status: 'sent', sent_at: '2026-10-09T17:00:00Z' },
  ],
  review_requests: [{ client_id: 'c1', rating: 5, sent_at: '2026-10-20T17:00:00Z' }, { client_id: 'c1', rating: null, sent_at: '2026-10-21T17:00:00Z' }],
  messages: [], opt_outs: [],
});
mock.module('../lib/supabase.js', { namedExports: { supabase: db.supabase, insertTolerant: () => ({}) } });
const sent = [];
globalThis.fetch = async (url, init) => {
  const p = Object.fromEntries(new URLSearchParams(init.body));
  sent.push({ to: p.To, body: p.Body });
  return new Response(JSON.stringify({ sid: 'SM1', status: 'queued' }), { status: 201 });
};
Object.assign(process.env, { TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 'tok', CRON_SECRET: 'cron', DASHBOARD_URL: 'https://rx.example' });

const { computeScorecard, monthRange, previousMonth, scorecardText } = await import('../lib/scorecard.js');
const { default: cron } = await import('../api/cron/[job].js');

test('month boundaries follow the business timezone', () => {
  const { from, to } = monthRange('2026-10', 'America/Los_Angeles');
  assert.equal(from.toISOString(), '2026-10-01T07:00:00.000Z');
  assert.equal(to.toISOString(), '2026-11-01T07:00:00.000Z');
  assert.equal(previousMonth(new Date('2026-11-01T16:00:00Z'), 'America/Los_Angeles'), '2026-10');
  assert.equal(previousMonth(new Date('2027-01-01T16:00:00Z'), 'America/Los_Angeles'), '2026-12');
});

test('October scorecard counts only what happened in October', async () => {
  const sc = await computeScorecard(db.tables.clients[0], '2026-10');
  assert.equal(sc.callsAnswered, 2);
  assert.equal(sc.afterHours, 1);
  assert.equal(sc.leads, 3);
  assert.deepEqual(sc.bySource, { angi: 1, form: 1, call: 1 });
  assert.equal(sc.medianResponseSeconds, 310); // 20s and 600s
  assert.equal(sc.answeredUnder5min, 1);
  assert.equal(sc.estimateLeadsFollowedUp, 1);
  assert.equal(sc.estimateReplies, 1);
  assert.equal(sc.booked, 2); // 1 booked call + 1 won outside lead
  assert.equal(sc.avgRating, 5);
  assert.equal(sc.estimatedValue, 1000);
  const text = scorecardText(db.tables.clients[0], sc, 'https://rx.example');
  assert.match(text, /^📊 Desert Air — October\n2 calls answered \(1 after hours\)/);
  assert.match(text, /Est\. value: ~\$1,000 \(at \$500\/job\)/);
});

test('monthly cron texts the owner once per run day', async () => {
  const run = async () => { const r = { statusCode: 200 }; r.status = (c) => (r.statusCode = c, r); r.json = (b) => (r.body = b, r);
    await cron({ query: { job: 'scorecard' }, headers: { authorization: 'Bearer cron' } }, r); return r; };
  let r = await run();
  assert.equal(r.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, '+17025550101');
  r = await run();
  assert.equal(r.body.results[0].skipped, 'already sent');
  assert.equal(sent.length, 1);
});
