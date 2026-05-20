/**
 * POST /api/waitlist
 * Called by Vapi as the `addToWaitlist` server-side tool.
 * Multi-tenant: resolves client from assistantId, stamps client_id on the row.
 */

import { supabase }          from '../lib/supabase.js';
import { formatLasVegas }    from '../lib/timezone.js';
import { verifyVapiRequest } from '../lib/vapi.js';
import { getClientByAgentId } from '../lib/clients.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyVapiRequest(req, res)) return;

  try {
    const body = req.body;

    // Identify which client this call belongs to
    const assistantId = body?.message?.call?.assistantId;
    const client      = await getClientByAgentId(assistantId);
    if (!client) {
      console.warn(`[waitlist] Unknown assistantId: ${assistantId}`);
    }

    // Support both Vapi tool-call envelope and direct test calls
    let args;
    if (body?.message?.toolCalls?.[0]?.function?.arguments) {
      args = body.message.toolCalls[0].function.arguments;
    } else {
      args = body;
    }

    const {
      patient_name,
      phone,
      preferred_days  = '',
      preferred_times = '',
      service_needed,
      priority = 'routine',
      notes    = '',
    } = args;

    if (!patient_name || !phone || !service_needed) {
      return res.status(400).json({
        error: 'patient_name, phone, and service_needed are required',
      });
    }

    const { data, error } = await supabase
      .from('waitlist')
      .insert([{
        client_id:       client?.id ?? null,
        patient_name:    patient_name.trim(),
        phone:           phone.trim(),
        preferred_days:  preferred_days.trim(),
        preferred_times: preferred_times.trim(),
        service_needed:  service_needed.trim(),
        priority:        ['urgent', 'routine'].includes(priority) ? priority : 'routine',
        notes:           notes.trim(),
        contacted:       false,
      }])
      .select()
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      return res.status(500).json({ error: 'Failed to save to waitlist' });
    }

    console.log(`[${formatLasVegas()}] Waitlist entry created: ${data.id} — ${patient_name} (${priority}) client=${client?.slug ?? 'unknown'}`);

    return res.status(200).json({
      results: [{
        toolCallId: body?.message?.toolCalls?.[0]?.id ?? 'direct-call',
        result: `Successfully added ${patient_name} to the waitlist. We'll reach out when a cancellation opens up.`,
      }],
    });
  } catch (err) {
    console.error('Waitlist handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
