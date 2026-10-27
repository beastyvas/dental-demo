/**
 * Jobber integration (OAuth app + webhooks + GraphQL).
 *
 * Setup (once): create an app in the Jobber Developer Center with
 *   redirect URL  https://<receptionist>/api/leads/jobber-callback
 *   webhook URL   https://<receptionist>/api/leads/jobber
 *   topics        visit/job completed, quote sent (names vary — any topic
 *                 matching TOPIC_ACTIONS below is handled; others are ignored)
 * and set JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET (and optionally
 * JOBBER_API_VERSION) on the receptionist.
 *
 * Per customer: the CRM shows a "Connect Jobber" link; the owner approves,
 * and the tokens land in clients.integrations.jobber.
 */

import crypto from 'node:crypto';
import { supabase } from './supabase.js';

const OAUTH = 'https://api.getjobber.com/api/oauth';
const GRAPHQL = 'https://api.getjobber.com/api/graphql';
const version = () => process.env.JOBBER_API_VERSION || '2025-04-16';

export const jobberConfigured = () => Boolean(process.env.JOBBER_CLIENT_ID && process.env.JOBBER_CLIENT_SECRET);

const redirectUri = (base) => `${base.replace(/\/$/, '')}/api/leads/jobber-callback`;

// OAuth `state` = client id + HMAC, so the callback knows which business connected.
const sign = (v) => crypto.createHmac('sha256', process.env.JWT_SECRET || process.env.JOBBER_CLIENT_SECRET).update(v).digest('base64url').slice(0, 32);
export const makeState = (clientId) => `${clientId}.${sign(clientId)}`;
export function readState(state) {
  const [id, mac] = String(state ?? '').split('.');
  if (!id || !mac) return null;
  const want = sign(id);
  return mac.length === want.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want)) ? id : null;
}

export function authorizeUrl(clientId, base) {
  return `${OAUTH}/authorize?${new URLSearchParams({
    response_type: 'code', client_id: process.env.JOBBER_CLIENT_ID, redirect_uri: redirectUri(base), state: makeState(clientId),
  })}`;
}

async function tokenRequest(params) {
  const r = await fetch(`${OAUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.JOBBER_CLIENT_ID, client_secret: process.env.JOBBER_CLIENT_SECRET, ...params }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new Error(`Jobber token request failed (${r.status}): ${data.error_description ?? data.error ?? JSON.stringify(data)}`);
  return {
    access_token: data.access_token,
    // Jobber rotates refresh tokens — always keep the newest.
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60_000).toISOString(),
  };
}

export async function graphql(accessToken, query, variables = {}) {
  const r = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-JOBBER-GRAPHQL-VERSION': version() },
    body: JSON.stringify({ query, variables }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.errors?.length) throw new Error(`Jobber API: ${data.errors?.[0]?.message ?? r.status}`);
  return data.data;
}

/** Callback: code → tokens → account id, saved on the client. */
export async function connect(clientId, code, base) {
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(base) });
  const { account } = await graphql(tokens.access_token, 'query { account { id name } }');
  const { data: client } = await supabase.from('clients').select('id, integrations').eq('id', clientId).maybeSingle();
  if (!client) throw new Error('Unknown business');
  const integrations = { ...(client.integrations ?? {}), jobber: { ...tokens, account_id: account.id, account_name: account.name, connected_at: new Date().toISOString() } };
  await supabase.from('clients').update({ integrations }).eq('id', clientId);
  return account;
}

/** A valid access token for this client, refreshing (and saving) if needed. */
export async function accessTokenFor(client) {
  const j = client.integrations?.jobber;
  if (!j?.refresh_token) throw new Error('Jobber not connected');
  if (j.access_token && new Date(j.expires_at) > new Date()) return j.access_token;
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: j.refresh_token });
  const integrations = { ...(client.integrations ?? {}), jobber: { ...j, ...fresh } };
  await supabase.from('clients').update({ integrations }).eq('id', client.id);
  client.integrations = integrations;
  return fresh.access_token;
}

/** X-Jobber-Hmac-SHA256 = base64(HMAC-SHA256(raw body, client secret)). */
export function validWebhook(rawBody, signature) {
  const secret = process.env.JOBBER_CLIENT_SECRET;
  if (!secret || !signature) return false;
  const want = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const a = Buffer.from(want);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Topic → what it means for the lead, and which object to fetch.
export const TOPIC_ACTIONS = [
  { match: /^VISIT_(COMPLETE|COMPLETED)$/, status: 'job_done', object: 'visit' },
  { match: /^JOB_(COMPLETE|COMPLETED|CLOSE|CLOSED)$/, status: 'job_done', object: 'job' },
  { match: /^QUOTE_SENT$/, status: 'estimate_sent', object: 'quote' },
];

const CLIENT_FIELDS = 'client { id name firstName phones { number primary } emails { address primary } }';
const QUERIES = {
  visit: `query($id: EncodedId!) { visit(id: $id) { id title job { id title ${CLIENT_FIELDS} } } }`,
  job:   `query($id: EncodedId!) { job(id: $id) { id title ${CLIENT_FIELDS} } }`,
  quote: `query($id: EncodedId!) { quote(id: $id) { id title ${CLIENT_FIELDS} } }`,
};

/** The customer behind a webhook item: { name, phone, email, title, external_id }. */
export async function fetchCustomer(client, object, itemId) {
  const data = await graphql(await accessTokenFor(client), QUERIES[object], { id: itemId });
  const item = data?.[object];
  const owner = item?.client ?? item?.job?.client;
  if (!owner) return null;
  const pick = (list, key) => (list?.find((x) => x.primary) ?? list?.[0])?.[key] ?? null;
  return {
    name: owner.name ?? owner.firstName ?? null,
    phone: pick(owner.phones, 'number'),
    email: pick(owner.emails, 'address'),
    title: item.title ?? item.job?.title ?? null,
    external_id: owner.id,
  };
}
