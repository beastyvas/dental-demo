/**
 * POST /api/vapi/events — Vapi server-URL webhook (assistant.server.url).
 *
 * Onboarding sets serverMessages: ['end-of-call-report'], so this sees one
 * request per finished call. For each call it:
 *   1. saves a `calls` row (transcript, recording, summary, outcome)
 *   2. texts the owner a summary
 *   3. texts the caller back if we lost them (hung up early / call errored)
 *   4. alerts the admin (ADMIN_ALERT_PHONE) when the call errored
 *
 * Vercel freezes a function once it responds, so all of that runs BEFORE we
 * answer. Every step is best-effort: one failure never blocks the others.
 */

import { supabase }            from '../../lib/supabase.js';
import { verifyVapiRequest }   from '../../lib/vapi.js';
import { getClientByAgentId }  from '../../lib/clients.js';
import { sendSMS, isOptedOut } from '../../lib/sms.js';
import { toE164 }              from '../../lib/phone.js';
import { isOpenAt }            from '../../lib/businessHours.js';
import {
  classifyCall, toolNamesFromArtifact, shouldTextBack, shouldNotifyOwner,
  ownerSummaryText, textBackText,
} from '../../lib/calls.js';

const dashboardUrl = () =>
  process.env.DASHBOARD_URL || (process.env.VERCEL_DOMAIN ? `https://${process.env.VERCEL_DOMAIN.replace(/^https?:\/\//, '')}` : null);

function durationOf(msg) {
  if (Number.isFinite(msg.durationSeconds)) return Math.round(msg.durationSeconds);
  const start = msg.startedAt ?? msg.call?.startedAt;
  const end   = msg.endedAt ?? msg.call?.endedAt;
  if (start && end) return Math.max(0, Math.round((new Date(end) - new Date(start)) / 1000));
  return 0;
}

async function textedRecently(clientId, phone) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  let q = supabase.from('messages').select('id').eq('to_number', phone).eq('kind', 'text_back').gte('created_at', since).limit(1);
  q = clientId ? q.eq('client_id', clientId) : q;
  const { data } = await q;
  return Boolean(data?.length);
}

async function safely(label, fn) {
  try { return await fn(); } catch (err) { console.error(`[vapi/events] ${label} failed:`, err.message); return null; }
}

export async function handleEndOfCall(msg) {
  const call        = msg.call ?? {};
  const callId      = call.id;
  if (!callId) return { skipped: 'no call id' };

  const client      = await getClientByAgentId(call.assistantId ?? msg.assistant?.id);
  const structured  = msg.analysis?.structuredData ?? {};
  const artifact    = msg.artifact ?? {};
  const callerPhone = toE164(msg.customer?.number ?? call.customer?.number);
  const duration    = durationOf(msg);
  const startedAt   = msg.startedAt ?? call.startedAt ?? null;

  const { data: leads = [] } = await supabase.from('waitlist').select('id, notes, patient_name').eq('vapi_call_id', callId);

  const outcome = classifyCall({
    endedReason: msg.endedReason,
    durationSeconds: duration,
    leads: leads ?? [],
    tools: toolNamesFromArtifact(artifact),
    structured,
    transfers: artifact.transfers?.length ?? 0,
  });

  const afterHours = client ? !isOpenAt(startedAt ? new Date(startedAt) : new Date(), client.timezone, client.business_hours) : false;
  const callerName = structured.caller_name || leads?.[0]?.patient_name || null;

  const { data: row } = await supabase.from('calls').upsert([{
    client_id:        client?.id ?? null,
    vapi_call_id:     callId,
    caller_phone:     callerPhone,
    caller_name:      callerName,
    started_at:       startedAt,
    ended_at:         msg.endedAt ?? call.endedAt ?? null,
    duration_seconds: duration,
    ended_reason:     msg.endedReason ?? null,
    outcome,
    summary:          msg.analysis?.summary ?? null,
    need:             structured.need ?? null,
    transcript:       artifact.transcript ?? null,
    recording_url:    artifact.recordingUrl ?? artifact.recording?.mono?.combinedUrl ?? null,
    after_hours:      afterHours,
    cost:             msg.cost ?? null,
  }], { onConflict: 'vapi_call_id' }).select('id').single();

  const callRowId = row?.id ?? null;
  const result = { outcome, textedBack: false, ownerNotified: false };

  // 1. Missed-call text-back to the caller
  if (client && callerPhone && (outcome === 'hangup' || outcome === 'error')) {
    const optedOut = await safely('opt-out check', () => isOptedOut(client.id, callerPhone));
    const recent   = await safely('recent check', () => textedRecently(client.id, callerPhone));
    if (shouldTextBack({ outcome, callerPhone, optedOut: Boolean(optedOut), textedRecently: Boolean(recent) })) {
      const sent = await safely('text-back', () => sendSMS(callerPhone,
        textBackText({ businessName: client.business_name, callbackNumber: client.twilio_number }),
        { client, kind: 'text_back', callId: callRowId }));
      result.textedBack = Boolean(sent);
    }
  }

  // 2. Owner summary
  const ownerPhone = client?.owner_phone ?? client?.doctor_phone;
  if (client && ownerPhone && shouldNotifyOwner({ outcome, durationSeconds: duration })) {
    const sent = await safely('owner summary', () => sendSMS(ownerPhone, ownerSummaryText({
      businessName: client.business_name, outcome, callerName, callerPhone,
      need: structured.need, summary: msg.analysis?.summary, afterHours,
      textedBack: result.textedBack, dashboardUrl: dashboardUrl(),
    }), { client, kind: 'owner_summary', callId: callRowId, skipOptOutCheck: true }));
    result.ownerNotified = Boolean(sent);
  }

  // 3. Admin alert when the agent itself broke
  if (outcome === 'error' && process.env.ADMIN_ALERT_PHONE) {
    await safely('admin alert', () => sendSMS(process.env.ADMIN_ALERT_PHONE,
      `⚠️ Vapi call error — ${client?.business_name ?? 'unknown client'}\nReason: ${msg.endedReason}\nCall: ${callId}\nCaller: ${callerPhone ?? 'unknown'}`,
      // Sent from the client's line when there's no TWILIO_DEFAULT_FROM.
      { kind: 'admin_alert', skipOptOutCheck: true, from: process.env.TWILIO_DEFAULT_FROM || client?.twilio_number || null }));
  }

  if (callRowId) {
    await safely('call flags', () => supabase.from('calls')
      .update({ owner_notified: result.ownerNotified, text_back_sent: result.textedBack }).eq('id', callRowId));
  }
  return result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyVapiRequest(req, res)) return;

  const msg = req.body?.message ?? {};
  try {
    if (msg.type === 'end-of-call-report') {
      const result = await handleEndOfCall(msg);
      return res.status(200).json({ ok: true, ...result });
    }
    return res.status(200).json({ ok: true, ignored: msg.type ?? 'unknown' });
  } catch (err) {
    console.error('[vapi/events] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
