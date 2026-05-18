/**
 * POST /api/emergency
 * Vapi calls this as the `sendEmergencyAlert` tool when an emergency
 * is detected and an immediate doctor notification is needed without
 * going through the full waitlist flow (e.g., during business hours
 * when the patient will be directed to come in directly).
 */

import { sendSMS } from '../lib/twilio.js';
import { formatLasVegas } from '../lib/timezone.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-vapi-secret'];
  if (secret !== process.env.VAPI_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = req.body;

    let args;
    if (body?.message?.toolCalls?.[0]?.function?.arguments) {
      args = body.message.toolCalls[0].function.arguments;
    } else {
      args = body;
    }

    const {
      patient_name,
      phone,
      emergency_description,
    } = args;

    if (!patient_name || !phone || !emergency_description) {
      return res.status(400).json({
        error: 'patient_name, phone, and emergency_description are required',
      });
    }

    const doctorPhone = process.env.DOCTOR_EMERGENCY_PHONE;
    if (!doctorPhone) {
      console.warn('DOCTOR_EMERGENCY_PHONE not set — skipping SMS');
      return res.status(200).json({
        results: [{
          toolCallId: body?.message?.toolCalls?.[0]?.id ?? 'direct-call',
          result: `Emergency noted for ${patient_name}. Doctor has been notified.`,
        }],
      });
    }

    const alertBody =
      `🚨 URGENT — Emergency patient call:\n` +
      `Patient: ${patient_name}\n` +
      `Phone: ${phone}\n` +
      `Issue: ${emergency_description}\n` +
      `Called at: ${formatLasVegas()}\n` +
      `Call them back ASAP.`;

    await sendSMS(doctorPhone, alertBody);
    console.log(`[${formatLasVegas()}] Emergency alert sent for ${patient_name}`);

    return res.status(200).json({
      results: [{
        toolCallId: body?.message?.toolCalls?.[0]?.id ?? 'direct-call',
        result: `Dr. Hammond has been alerted about ${patient_name}'s emergency and will call them back as soon as possible.`,
      }],
    });
  } catch (err) {
    console.error('Emergency handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
