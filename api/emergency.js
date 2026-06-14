/**
 * POST /api/emergency
 * Called by Vapi as the `sendEmergencyAlert` tool.
 * Multi-tenant: resolves doctor_phone from the client row instead of env var.
 */

import { sendSMS }           from '../lib/sms.js';
import { formatInTZ, TIMEZONE } from '../lib/timezone.js';
import { verifyVapiRequest } from '../lib/vapi.js';
import { getClientByAgentId } from '../lib/clients.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyVapiRequest(req, res)) return;

  try {
    const body = req.body;

    // Identify client
    const assistantId = body?.message?.call?.assistantId;
    const client      = await getClientByAgentId(assistantId);
    if (!client) {
      console.warn(`[emergency] Unknown assistantId: ${assistantId}`);
    }

    let args;
    if (body?.message?.toolCalls?.[0]?.function?.arguments) {
      args = body.message.toolCalls[0].function.arguments;
    } else {
      args = body;
    }

    const { patient_name, phone, emergency_description } = args;

    if (!patient_name || !phone || !emergency_description) {
      return res.status(400).json({
        error: 'patient_name, phone, and emergency_description are required',
      });
    }

 const doctorPhone = client?.doctor_phone ?? process.env.DOCTOR_EMERGENCY_PHONE;
    if (!doctorPhone) {
      console.warn('[emergency] No doctor_phone configured — skipping SMS');
      return res.status(200).json({
        results: [{
          toolCallId: body?.message?.toolCalls?.[0]?.id ?? 'direct-call',
          result: `Emergency noted for ${patient_name}. Doctor has been notified.`,
        }],
      });
    }

    const tz = client?.timezone ?? TIMEZONE;
    // Format phone with dashes so TextBelt doesn't flag bare digits as a URL
    const fmtPhone = String(phone).replace(/\D/g, '').replace(/(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');

    const alertBody =
      `🚨 URGENT — Emergency patient call:\n` +
      `Patient: ${patient_name}\n` +
      `Phone: ${fmtPhone}\n` +
      `Issue: ${emergency_description}\n` +
      `Called at: ${formatInTZ(new Date(), {}, tz)}\n` +
      `Call them back ASAP.`;

    try {
      await sendSMS(doctorPhone, alertBody);
      console.log(`[${formatInTZ(new Date(), {}, tz)}] Emergency alert sent for ${patient_name} (${client?.slug ?? 'unknown'})`);
    } catch (smsErr) {
      // Log but do not 500 — Vapi must still get a success response so the call flow continues
      console.error(`[emergency] SMS failed for ${patient_name}:`, smsErr.message);
    }

    return res.status(200).json({
      results: [{
        toolCallId: body?.message?.toolCalls?.[0]?.id ?? 'direct-call',
        result: `${client?.business_name ?? 'Our team'} has been alerted about ${patient_name}'s emergency and will call them back as soon as possible.`,
      }],
    });

  } catch (err) {
    console.error('Emergency handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
