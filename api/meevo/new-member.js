/**
 * POST /api/meevo/new-member
 * Vapi tool: `logNewMemberInquiry`
 * Logs a new (non-member) caller to the dashboard and immediately
 * texts the front desk so no lead slips through after hours.
 */

import { supabase }            from '../../lib/supabase.js';
import { sendSMS }             from '../../lib/sms.js';
import { verifyVapiRequest }   from '../../lib/vapi.js';
import { getClientByAgentId }  from '../../lib/clients.js';
import { formatInTZ, TIMEZONE } from '../../lib/timezone.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
      reason = 'new_member', // 'new_member' | 'after_hours' | 'card_required'
      notes = '',
    } = args;

    if (!guest_name || !phone) {
      return res.status(400).json({ error: 'guest_name and phone are required' });
    }

    const now = formatInTZ(new Date(), {}, tz);

    // Compose a clear note for the dashboard
    const reasonLabel = {
      new_member:    'NEW MEMBER — needs account + card on file',
      after_hours:   'AFTER HOURS booking request',
      card_required: 'CARD ON FILE missing — needs front desk',
    }[reason] ?? reason;

    const fullNotes = `${reasonLabel} | Called: ${now}${service_interest ? ` | Wants: ${service_interest}` : ''}${notes ? ` | ${notes}` : ''}`;

    // Log to dashboard
    await supabase.from('waitlist').insert([{
      client_id:      client?.id ?? null,
      patient_name:   guest_name.trim(),
      phone:          phone.trim(),
      service_needed: service_interest.trim() || 'To be confirmed',
      preferred_days:  '',
      preferred_times: '',
      priority:       'routine',
      notes:          fullNotes,
      contacted:      false,
    }]);

    // Fire immediate SMS to front desk
    const frontDeskPhone = client?.front_desk_phone;
    if (frontDeskPhone) {
      const smsReasons = {
        new_member:    '🔔 New member inquiry',
        after_hours:   '🌙 After-hours booking request',
        card_required: '💳 Card on file needed',
      };
      const smsLabel = smsReasons[reason] ?? '📋 Callback needed';

      await sendSMS(
        frontDeskPhone,
        `${smsLabel} via virtual receptionist:\n` +
        `Name: ${guest_name}\n` +
        `Phone: ${phone}\n` +
        (service_interest ? `Wants: ${service_interest}\n` : '') +
        `Called at: ${now}\n` +
        `→ Follow up ASAP to ${reason === 'new_member' ? 'create account + book' : 'confirm appointment'}.`
      );
    }

    const toolCallId = body?.message?.toolCalls?.[0]?.id ?? 'direct-call';
    console.log(`[meevo/new-member] ${reason} — ${guest_name} (${phone}) | client=${client?.slug ?? 'unknown'}`);

    const responses = {
      new_member:
        `Got it. I've passed your info to our team — someone will call you to get your account set up and lock in your appointment. Anything else I can help with?`,
      after_hours:
        `We're closed right now but I've logged your request. Our team will reach out first thing in the morning to get you booked. Is there anything else?`,
      card_required:
        `No problem — I've flagged your info for our front desk and they'll reach out shortly to get that sorted and get you booked. Is there anything else?`,
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
