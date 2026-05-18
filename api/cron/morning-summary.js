/**
 * GET /api/cron/morning-summary
 * Vercel cron — runs at 8:00 AM Las Vegas time Mon–Sat.
 * Schedule in vercel.json: "0 15 * * 1-6"
 *   (15:00 UTC = 8:00 AM PDT, Apr–Oct)
 *   (Add CRON_OFFSET_WINTER=1 in Nov–Mar when clocks fall back to adjust manually)
 *
 * 1. Queries waitlist for uncontacted entries in the last 24 hours
 * 2. Formats a summary SMS
 * 3. Sends to front desk number
 * 4. Marks all included entries as contacted = true
 */

import { supabase } from '../../lib/supabase.js';
import { sendSMS } from '../../lib/twilio.js';
import { formatLasVegas } from '../../lib/timezone.js';

export default async function handler(req, res) {
  // Vercel protects cron routes with CRON_SECRET automatically (Vercel Cron)
  // Manual invocation requires the same secret in Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: entries, error } = await supabase
      .from('waitlist')
      .select('*')
      .eq('contacted', false)
      .gte('created_at', since)
      .order('priority', { ascending: false }) // urgent first
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Supabase query error:', error);
      return res.status(500).json({ error: 'Database query failed' });
    }

    const frontDesk = process.env.FRONT_DESK_PHONE;
    if (!frontDesk) {
      return res.status(500).json({ error: 'FRONT_DESK_PHONE not set' });
    }

    if (!entries || entries.length === 0) {
      const msg =
        `Good morning! No overnight waitlist entries to report.\n\n` +
        `Have a great day! — AI Receptionist`;
      await sendSMS(frontDesk, msg);
      return res.status(200).json({ sent: true, entryCount: 0 });
    }

    // Separate by priority
    const routine  = entries.filter(e => e.priority === 'routine');
    const urgent   = entries.filter(e => e.priority === 'urgent');

    let msg = `Good morning! Here's your overnight call summary:\n\n`;

    if (routine.length > 0) {
      msg += `📋 WAITLIST ADDITIONS (${routine.length}):\n`;
      routine.forEach((e, i) => {
        const days  = e.preferred_days  || 'any day';
        const times = e.preferred_times || 'any time';
        msg += `${i + 1}. ${e.patient_name} — ${e.service_needed}, prefers ${days} / ${times}\n`;
        msg += `   📞 ${e.phone}\n`;
      });
      msg += '\n';
    }

    if (urgent.length > 0) {
      msg += `🚨 EMERGENCIES (${urgent.length}):\n`;
      urgent.forEach((e, i) => {
        const timeStr = formatLasVegas(e.created_at, {
          hour: 'numeric', minute: '2-digit', hour12: true,
          weekday: undefined, year: undefined, month: undefined, day: undefined,
        });
        msg += `${i + 1}. ${e.patient_name} — ${e.service_needed}\n`;
        msg += `   📞 ${e.phone}\n`;
        msg += `   ⚠️ Already alerted at ${timeStr}\n`;
      });
      msg += '\n';
    }

    msg += `Total overnight inquiries handled: ${entries.length}\n`;
    msg += `Calls that would have gone to voicemail: ${entries.length}\n\n`;
    msg += `Have a great day! — AI Receptionist`;

    await sendSMS(frontDesk, msg);

    // Mark all included entries as contacted
    const ids = entries.map(e => e.id);
    const { error: updateError } = await supabase
      .from('waitlist')
      .update({ contacted: true })
      .in('id', ids);

    if (updateError) {
      console.error('Failed to mark entries as contacted:', updateError);
      // Don't fail the response — SMS was already sent
    }

    console.log(`[${formatLasVegas()}] Morning summary sent — ${entries.length} entries`);
    return res.status(200).json({ sent: true, entryCount: entries.length });
  } catch (err) {
    console.error('Morning summary error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
