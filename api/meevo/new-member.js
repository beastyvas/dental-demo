/**
 * POST /api/meevo/new-member
 * Vapi tool: `logNewMemberInquiry`
 *
 * Handles callers who can't be booked directly:
 *   - new_member:    non-member; needs account + card on file
 *   - after_hours:   office closed; log for morning follow-up
 *   - card_required: existing member missing card on file
 *
 * When MEEVO_* env vars + client.meevo_site_id are present:
 *   - Searches Meevo for an existing client record by phone
 *   - Creates a new client record if not found (new_member case)
 * Always logs to the dashboard and fires an SMS to the front desk.
 */

import { supabase }            from '../../lib/supabase.js';
import { sendSMS }             from '../../lib/sms.js';
import { verifyVapiRequest }   from '../../lib/vapi.js';
import { getClientByAgentId }  from '../../lib/clients.js';
import { formatInTZ, TIMEZONE } from '../../lib/timezone.js';
import {
  meevoConfigured,
  findClientByPhone,
  createClient,
} from '../../lib/meevo.js';

// ── Meevo client resolution ───────────────────────────────────────────────────

async function resolveOrCreateMeevoClient({ siteId, guestName, phone, reason }) {
  const existing = await findClientByPhone(siteId, phone);
  if (existing) {
    return { action: 'found', clientId: existing.clientId ?? existing.id };
  }

  if (reason !== 'new_member') {
    // For after_hours / card_required we don't auto-create; just flag for staff
    return { action: 'not_found', clientId: null };
  }

  // Split name best-effort (Meevo needs first + last)
  const parts     = guestName.trim().split(/\s+/);
  const firstName = parts[0] ?? guestName;
  const lastName  = parts.slice(1).join(' ') || 'Unknown';

  try {
    const created = await createClient({ siteId, firstName, lastName, phone });
    return { action: 'created', clientId: created.clientId };
  } catch (err) {
    console.warn(`[meevo/new-member] Could not create Meevo client: ${err.message}`);
    return { action: 'create_failed', clientId: null };
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyVapiRequest(req, res)) return;

  try {
    const body        = req.body;
    const assistantId = body?.message?.call?.assistantId;
    const client      = await getClientByAgentId(assistantId);
    const tz          = client?.timezone ?? TIMEZONE;

    let args;
    if (body?.message?.toolCalls?.[0]?.function?.arguments) {
      args = body.message.toolCalls[0].function.arguments;
    } else {
      args = body;
    }

    const {
      guest_name,
      phone,
      service_interest = '',
      reason           = 'new_member',
      notes            = '',
    } = args;

    if (!guest_name || !phone) {
      return res.status(400).json({ error: 'guest_name and phone are required' });
    }

    const now = formatInTZ(new Date(), {}, tz);

    // ── Meevo client lookup / creation ────────────────────────────────────────
    let meevoNote = '';
    if (meevoConfigured() && client?.meevo_site_id) {
      try {
        const { action, clientId } = await resolveOrCreateMeevoClient({
          siteId:    client.meevo_site_id,
          guestName: guest_name,
          phone,
          reason,
        });

        const actionLabels = {
          found:         `Meevo client found (ID: ${clientId})`,
          created:       `Meevo client created (ID: ${clientId})`,
          not_found:     'Not in Meevo — needs manual entry',
          create_failed: 'Meevo create failed — needs manual entry',
        };
        meevoNote = ` | ${actionLabels[action] ?? action}`;
      } catch (err) {
        console.warn(`[meevo/new-member] Meevo lookup error: ${err.message}`);
        meevoNote = ' | Meevo lookup failed — check manually';
      }
    }

    // ── Dashboard note ────────────────────────────────────────────────────────
    const reasonLabel = {
      new_member:    'NEW MEMBER — needs account + card on file',
      after_hours:   'AFTER HOURS booking request',
      card_required: 'CARD ON FILE missing — needs front desk',
    }[reason] ?? reason;

    const fullNotes = [
      reasonLabel,
      `Called: ${now}`,
      service_interest ? `Wants: ${service_interest}` : null,
      meevoNote ? meevoNote.replace(' | ', '') : null,
      notes || null,
    ].filter(Boolean).join(' | ');

    await supabase.from('waitlist').insert([{
      client_id:       client?.id ?? null,
      patient_name:    guest_name.trim(),
      phone:           phone.trim(),
      service_needed:  service_interest.trim() || 'To be confirmed',
      preferred_days:  '',
      preferred_times: '',
      priority:        'routine',
      notes:           fullNotes,
      contacted:       false,
    }]);

    // ── Front desk SMS ────────────────────────────────────────────────────────
    const frontDeskPhone = client?.front_desk_phone;
    if (frontDeskPhone) {
      const smsLabels = {
        new_member:    '🔔 New member inquiry',
        after_hours:   '🌙 After-hours booking request',
        card_required: '💳 Card on file needed',
      };
      const smsLabel   = smsLabels[reason] ?? '📋 Callback needed';
      const followUpMsg = reason === 'new_member'
        ? 'create account + book'
        : 'confirm appointment';

      await sendSMS(
        frontDeskPhone,
        `${smsLabel} via virtual receptionist:\n` +
        `Name: ${guest_name}\n` +
        `Phone: ${phone}\n` +
        (service_interest ? `Wants: ${service_interest}\n` : '') +
        `Called at: ${now}\n` +
        (meevoNote ? `${meevoNote.replace(' | ', '').trim()}\n` : '') +
        `→ Follow up ASAP to ${followUpMsg}.`
      );
    }

    const toolCallId = body?.message?.toolCalls?.[0]?.id ?? 'direct-call';
    console.log(`[meevo/new-member] ${reason} — ${guest_name} (${phone}) | client=${client?.slug ?? 'unknown'}${meevoNote}`);

    const responses = {
      new_member:
        `Got it! I've passed your info to our team — someone will call you to get your account set up and lock in your appointment. Is there anything else I can help with?`,
      after_hours:
        `We're closed right now but I've logged your request. Our team will reach out first thing in the morning to get you booked. Is there anything else?`,
      card_required:
        `No problem — I've flagged your info for our front desk and they'll reach out shortly to sort that out and get you booked. Is there anything else?`,
    };

    return res.status(200).json({
      results: [{
        toolCallId,
        result: responses[reason] ?? responses.new_member,
      }],
    });
  } catch (err) {
    console.error('[meevo/new-member] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
