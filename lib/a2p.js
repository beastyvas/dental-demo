/**
 * Per-client A2P 10DLC registration (Twilio's ISV flow), so each business
 * texts as itself instead of under our brand. Twilio reviews each stage over
 * hours to days, so this is a resumable state machine saved in clients.a2p:
 *
 *   start          → customer profile + A2P trust product created and submitted
 *   profiles_pending → (both approved) → brand registered
 *   brand_pending    → (brand approved) → messaging service + number + campaign
 *   campaign_pending → (campaign verified) → live
 *   rejected / failed (reason saved — fix the info and re-submit)
 *
 * advance(client) moves it forward; the admin API calls it on demand and the
 * cron (/api/cron/a2p) hourly. Needs a live run against Twilio to confirm:
 * policy SIDs and enum values follow Twilio's ISV guide and can be overridden
 * with env vars if Twilio changes them.
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PRIMARY_PROFILE_SID (our
 * own approved primary customer profile, BU…), optional
 * TWILIO_A2P_PROFILE_POLICY_SID / TWILIO_A2P_TRUST_POLICY_SID.
 */

import { supabase } from './supabase.js';
import { toE164 } from './phone.js';
import { automationFor, templateVars, render } from './automation.js';

const PROFILE_POLICY = () => process.env.TWILIO_A2P_PROFILE_POLICY_SID || 'RNdfbf3fae0e1107f8aded0e7cead80bf5';
const TRUST_POLICY = () => process.env.TWILIO_A2P_TRUST_POLICY_SID || 'RNb0d4771c2c98518d916a3d4cd70a8f8b';

export const BUSINESS_TYPES = ['Sole Proprietorship', 'Partnership', 'Limited Liability Corporation', 'Corporation', 'Co-operative', 'Non-profit Corporation'];
export const JOB_POSITIONS = ['CEO', 'GM', 'Director', 'VP', 'CFO', 'General Counsel', 'Other'];
export const a2pConfigured = () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PRIMARY_PROFILE_SID);

const REQUIRED = ['legal_name', 'ein', 'business_type', 'website', 'street', 'city', 'state', 'zip',
  'rep_first_name', 'rep_last_name', 'rep_email', 'rep_phone', 'rep_title', 'rep_position'];

export function validateInfo(info) {
  const problems = REQUIRED.filter((k) => !String(info?.[k] ?? '').trim()).map((k) => `missing ${k}`);
  if (info?.ein && !/^\d{2}-?\d{7}$/.test(String(info.ein).trim())) problems.push('EIN must look like 12-3456789');
  if (info?.business_type && !BUSINESS_TYPES.includes(info.business_type)) problems.push('pick a business type');
  if (info?.rep_position && !JOB_POSITIONS.includes(info.rep_position)) problems.push('pick a job position');
  if (info?.website && !/^https?:\/\//.test(info.website)) problems.push('website must start with https://');
  if (info?.rep_phone && !toE164(info.rep_phone)) problems.push('rep phone is not a phone number');
  if (info?.state && !/^[A-Z]{2}$/i.test(info.state)) problems.push('state must be 2 letters');
  return problems;
}

// ── Twilio REST (several hosts, form-encoded, repeated keys for arrays) ────

function form(params) {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => out.append(k, String(x)));
    else out.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return out;
}

async function tw(method, url, params) {
  const auth = 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const r = await fetch(url, {
    method,
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' || method === 'DELETE' ? undefined : form(params),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Twilio ${method} ${new URL(url).pathname}: ${data.message ?? r.status}`), { status: r.status, code: data.code });
  return data;
}
const TH = 'https://trusthub.twilio.com/v1';
const MSG = 'https://messaging.twilio.com/v1';
const API = () => `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}`;

async function save(client, a2p) {
  await supabase.from('clients').update({ a2p }).eq('id', client.id);
  client.a2p = a2p;
  return a2p;
}

// ── Step 1: customer profile + trust product ───────────────────────────────

async function createProfiles(client, info) {
  const email = info.rep_email;
  const profile = await tw('POST', `${TH}/CustomerProfiles`, {
    FriendlyName: `${info.legal_name} (secondary)`, Email: email, PolicySid: PROFILE_POLICY(),
  });
  const business = await tw('POST', `${TH}/EndUsers`, {
    FriendlyName: `${info.legal_name} business info`,
    Type: 'customer_profile_business_information',
    Attributes: {
      business_name: info.legal_name,
      business_identity: 'direct_customer',
      business_type: info.business_type,
      business_industry: 'CONSTRUCTION',
      business_registration_identifier: 'EIN',
      business_registration_number: String(info.ein).replace(/\D/g, ''),
      business_regions_of_operation: 'USA_AND_CANADA',
      website_url: info.website,
      social_media_profile_urls: info.social ?? '',
    },
  });
  const rep = await tw('POST', `${TH}/EndUsers`, {
    FriendlyName: `${info.rep_first_name} ${info.rep_last_name}`,
    Type: 'authorized_representative_1',
    Attributes: {
      first_name: info.rep_first_name, last_name: info.rep_last_name, email,
      phone_number: toE164(info.rep_phone), business_title: info.rep_title, job_position: info.rep_position,
    },
  });
  const address = await tw('POST', `${API()}/Addresses.json`, {
    CustomerName: info.legal_name, Street: info.street, City: info.city, Region: info.state.toUpperCase(),
    PostalCode: info.zip, IsoCountry: 'US',
  });
  const doc = await tw('POST', `${TH}/SupportingDocuments`, {
    FriendlyName: `${info.legal_name} address`, Type: 'customer_profile_address', Attributes: { address_sids: address.sid },
  });
  for (const sid of [business.sid, rep.sid, doc.sid, process.env.TWILIO_PRIMARY_PROFILE_SID]) {
    await tw('POST', `${TH}/CustomerProfiles/${profile.sid}/EntityAssignments`, { ObjectSid: sid });
  }
  await tw('POST', `${TH}/CustomerProfiles/${profile.sid}/Evaluations`, { PolicySid: PROFILE_POLICY() });
  await tw('POST', `${TH}/CustomerProfiles/${profile.sid}`, { Status: 'pending-review' });

  const trust = await tw('POST', `${TH}/TrustProducts`, {
    FriendlyName: `${info.legal_name} A2P`, Email: email, PolicySid: TRUST_POLICY(),
  });
  const msgProfile = await tw('POST', `${TH}/EndUsers`, {
    FriendlyName: `${info.legal_name} messaging profile`,
    Type: 'us_a2p_messaging_profile_information',
    Attributes: { company_type: 'private' },
  });
  for (const sid of [msgProfile.sid, profile.sid]) {
    await tw('POST', `${TH}/TrustProducts/${trust.sid}/EntityAssignments`, { ObjectSid: sid });
  }
  await tw('POST', `${TH}/TrustProducts/${trust.sid}/Evaluations`, { PolicySid: TRUST_POLICY() });
  await tw('POST', `${TH}/TrustProducts/${trust.sid}`, { Status: 'pending-review' });
  return { customer_profile_sid: profile.sid, trust_product_sid: trust.sid, address_sid: address.sid };
}

// ── Campaign content, from what we actually send ──────────────────────────

export function campaignContent(client) {
  const auto = automationFor(client);
  const vars = templateVars(client, { name: 'Sam', message: 'an AC tune-up', service: 'AC tune-up' }, { when: 'Thu, Nov 5 at 2:00 PM' });
  return {
    Description: `${client.business_name} texts its own customers and leads: replies to quote requests and missed calls, appointment reminders, estimate follow-ups, review requests after completed jobs, and occasional check-ins with past customers.`,
    MessageFlow: `People give ${client.business_name} their number by calling the business, submitting the quote form on its website (which states they agree to be called or texted about their request and can reply STOP), or as existing customers. Every message identifies the business and recipients can reply STOP to opt out at any time.`,
    MessageSamples: [
      render(auto.speed_template, vars),
      render(auto.reminder_template, vars),
      render(auto.estimate_templates[0], vars),
      `Hi Sam! Thanks for choosing ${client.business_name}. How did we do? It takes 10 seconds: https://example.com/review/abc Reply STOP to opt out.`,
    ].map((s) => s.slice(0, 1024)),
    UsAppToPersonUsecase: 'MIXED',
    HasEmbeddedLinks: true,
    HasEmbeddedPhone: false,
  };
}

// ── The state machine ─────────────────────────────────────────────────────

export async function start(client, info) {
  const problems = validateInfo(info);
  if (problems.length) throw Object.assign(new Error(problems.join('; ')), { status: 400 });
  if (!a2pConfigured()) throw Object.assign(new Error('Set TWILIO_PRIMARY_PROFILE_SID (our own approved customer profile) first'), { status: 400 });
  const cur = client.a2p ?? {};
  if (cur.status && !['rejected', 'failed'].includes(cur.status)) {
    throw Object.assign(new Error(`Registration already ${cur.status.replace('_', ' ')}`), { status: 409 });
  }
  const sids = await createProfiles(client, info);
  return save(client, { info, ...sids, status: 'profiles_pending', updated_at: new Date().toISOString(), history: [...(cur.history ?? []), { at: new Date().toISOString(), status: 'profiles_pending' }] });
}

export async function advance(client, { baseUrl } = {}) {
  let a = { ...(client.a2p ?? {}) };
  if (!a.status || ['live', 'rejected', 'failed'].includes(a.status)) return a;
  const step = (status, extra = {}) => {
    a = { ...a, ...extra, status, updated_at: new Date().toISOString(), history: [...(a.history ?? []), { at: new Date().toISOString(), status }] };
  };

  try {
    if (a.status === 'profiles_pending') {
      const [p, t] = await Promise.all([
        tw('GET', `${TH}/CustomerProfiles/${a.customer_profile_sid}`),
        tw('GET', `${TH}/TrustProducts/${a.trust_product_sid}`),
      ]);
      if ([p.status, t.status].includes('twilio-rejected')) {
        step('rejected', { reason: `Profile ${p.status}, A2P profile ${t.status} — check the business info (EIN must match the legal name exactly)` });
      } else if (p.status === 'twilio-approved' && t.status === 'twilio-approved') {
        const brand = await tw('POST', `${MSG}/a2p/BrandRegistrations`, {
          CustomerProfileBundleSid: a.customer_profile_sid, A2PProfileBundleSid: a.trust_product_sid,
        });
        step('brand_pending', { brand_sid: brand.sid });
      }
    } else if (a.status === 'brand_pending') {
      const b = await tw('GET', `${MSG}/a2p/BrandRegistrations/${a.brand_sid}`);
      if (b.status === 'FAILED') {
        step('rejected', { reason: `Brand failed: ${(b.failure_reason ?? b.errors?.[0]?.description) || 'see Twilio console'}` });
      } else if (b.status === 'APPROVED') {
        const service = await tw('POST', `${MSG}/Services`, {
          FriendlyName: `${client.business_name}`.slice(0, 64),
          UseInboundWebhookOnNumber: true, // replies keep hitting /api/twilio/sms on the number
        });
        a = { ...a, messaging_service_sid: service.sid };
        // A number can only be in one messaging service — leave our shared one.
        if (client.twilio_number_sid && process.env.TWILIO_MESSAGING_SERVICE_SID) {
          await tw('DELETE', `${MSG}/Services/${process.env.TWILIO_MESSAGING_SERVICE_SID}/PhoneNumbers/${client.twilio_number_sid}`).catch(() => null);
        }
        if (client.twilio_number_sid) {
          await tw('POST', `${MSG}/Services/${service.sid}/PhoneNumbers`, { PhoneNumberSid: client.twilio_number_sid });
        }
        const campaign = await tw('POST', `${MSG}/Services/${service.sid}/Compliance/Usa2p`, {
          BrandRegistrationSid: a.brand_sid, ...campaignContent(client),
        });
        step('campaign_pending', { campaign_sid: campaign.sid });
      }
    } else if (a.status === 'campaign_pending') {
      const c = await tw('GET', `${MSG}/Services/${a.messaging_service_sid}/Compliance/Usa2p/${a.campaign_sid}`);
      if (c.campaign_status === 'FAILED') step('rejected', { reason: `Campaign failed: ${c.errors?.[0]?.description ?? 'see Twilio console'}` });
      else if (c.campaign_status === 'VERIFIED') step('live');
    }
  } catch (err) {
    a = { ...a, last_error: err.message, updated_at: new Date().toISOString() };
  }
  return save(client, a);
}

/** What the CRM shows — never the raw info's EIN in full. */
export function publicA2p(a2p) {
  if (!a2p) return { status: null };
  const { info, ...rest } = a2p;
  return { ...rest, info: info ? { ...info, ein: info.ein ? `••-•••${String(info.ein).slice(-4)}` : null } : null };
}
