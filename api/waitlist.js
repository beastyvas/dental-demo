/**
 * POST /api/waitlist
 * Called by Vapi as a server-side tool when the AI collects waitlist info.
 *
 * Vapi sends the tool call result as JSON:
 * {
 *   "message": {
 *     "toolCalls": [{
 *       "id": "...",
 *       "function": {
 *         "name": "addToWaitlist",
 *         "arguments": { ...patient fields... }
 *       }
 *     }]
 *   }
 * }
 *
 * We extract the arguments, write to Supabase, and return the
 * toolCallResult format Vapi expects.
 */

import { supabase } from '../lib/supabase.js';
import { formatLasVegas } from '../lib/timezone.js';
import { sendSMS } from '../lib/twilio.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify shared secret so random callers can't pollute the table
  const secret = req.headers['x-vapi-secret'];
  if (secret !== process.env.VAPI_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = req.body;

    // Support both direct calls and Vapi tool-call envelope
    let args;
    if (body?.message?.toolCalls?.[0]?.function?.arguments) {
      args = body.message.toolCalls[0].function.arguments;
    } else {
      args = body; // direct / test call
    }

    const {
      patient_name,
      phone,
      preferred_days = '',
      preferred_times = '',
      service_needed,
      priority = 'routine',
      notes = '',
    } = args;

    if (!patient_name || !phone || !service_needed) {
      return res.status(400).json({
        error: 'patient_name, phone, and service_needed are required',
      });
    }

    const { data, error } = await supabase
      .from('waitlist')
      .insert([
        {
          patient_name: patient_name.trim(),
          phone: phone.trim(),
          preferred_days: preferred_days.trim(),
          preferred_times: preferred_times.trim(),
          service_needed: service_needed.trim(),
          priority: ['urgent', 'routine'].includes(priority) ? priority : 'routine',
          notes: notes.trim(),
          contacted: false,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      return res.status(500).json({ error: 'Failed to save to waitlist' });
    }

    console.log(`[${formatLasVegas()}] Waitlist entry created: ${data.id} — ${patient_name} (${priority})`);

    // Feature 2: fire doctor SMS immediately for urgent/emergency entries
    if (priority === 'urgent') {
      const doctorPhone = process.env.DOCTOR_EMERGENCY_PHONE;
      if (doctorPhone) {
        const alertBody =
          `🚨 URGENT — Emergency patient call:\n` +
          `Patient: ${patient_name}\n` +
          `Phone: ${phone}\n` +
          `Issue: ${service_needed}${notes ? ' — ' + notes : ''}\n` +
          `Called at: ${formatLasVegas()}\n` +
          `Call them back ASAP.`;
        await sendSMS(doctorPhone, alertBody).catch(err =>
          console.error('Failed to send doctor SMS:', err)
        );
      }
    }

    // Vapi expects this shape when a tool call succeeds
    return res.status(200).json({
      results: [
        {
          toolCallId: body?.message?.toolCalls?.[0]?.id ?? 'direct-call',
          result: `Successfully added ${patient_name} to the waitlist. We'll reach out when a cancellation opens up.`,
        },
      ],
    });
  } catch (err) {
    console.error('Waitlist handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
