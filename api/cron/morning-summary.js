/**
 * GET /api/cron/morning-summary
 * Vercel cron — runs at 8:00 AM Las Vegas time Mon–Sat.
 * Schedule in vercel.json: "0 15 * * 1-6"
 *   (15:00 UTC = 8:00 AM PDT, Apr–Oct)
 *
 * Multi-tenant: loops all active clients and sends each a separate SMS summary.
 * Each summary covers uncontacted entries in the last 24 hours for that client.
 */

import { supabase }           from '../../lib/supabase.js';
import { sendSMS }            from '../../lib/sms.js';
import { formatInTZ, TIMEZONE } from '../../lib/timezone.js';
import { getAllActiveClients } from '../../lib/clients.js';

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const since   = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const clients = await getAllActiveClients();

    if (clients.length === 0) {
      console.log('[morning-summary] No active clients found');
      return res.status(200).json({ sent: 0 });
    }

    const results = [];

    for (const client of clients) {
      const tz = client.timezone ?? TIMEZONE;

      const { data: entries, error } = await supabase
        .from('waitlist')
        .select('*')
        .eq('client_id', client.id)
        .eq('contacted', false)
        .gte('created_at', since)
        .order('priority',   { ascending: false })
        .order('created_at', { ascending: true });

      if (error) {
        console.error(`[morning-summary] Supabase error for ${client.slug}:`, error);
        results.push({ slug: client.slug, error: 'db_error' });
        continue;
      }

      if (!entries || entries.length === 0) {
        const msg =
          `Good morning! No overnight waitlist entries for ${client.business_name}.\n\n` +
          `Have a great day! — Virtual Receptionist`;
        await sendSMS(client.front_desk_phone, msg);
        results.push({ slug: client.slug, entryCount: 0 });
        continue;
      }

      const routine = entries.filter(e => e.priority === 'routine');
      const urgent  = entries.filter(e => e.priority === 'urgent');

      let msg = `Good morning! Here's your overnight call summary for ${client.business_name}:\n\n`;

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
          const timeStr = formatInTZ(e.created_at, {
            hour: 'numeric', minute: '2-digit', hour12: true,
            weekday: undefined, year: undefined, month: undefined, day: undefined,
          }, tz);
          msg += `${i + 1}. ${e.patient_name} — ${e.service_needed}\n`;
          msg += `   📞 ${e.phone}\n`;
          msg += `   ⚠️ Already alerted at ${timeStr}\n`;
        });
        msg += '\n';
      }

      msg += `Total overnight inquiries: ${entries.length}\n`;
      msg += `Have a great day! — Virtual Receptionist`;

      await sendSMS(client.front_desk_phone, msg);

      // Mark all included entries as contacted
      const ids = entries.map(e => e.id);
      const { error: updateError } = await supabase
        .from('waitlist')
        .update({ contacted: true })
        .in('id', ids);

      if (updateError) {
        console.error(`[morning-summary] Failed to mark entries for ${client.slug}:`, updateError);
      }

      console.log(`[${formatInTZ(new Date(), {}, tz)}] Morning summary sent — ${client.slug}: ${entries.length} entries`);
      results.push({ slug: client.slug, entryCount: entries.length });
    }

    return res.status(200).json({ results });
  } catch (err) {
    console.error('Morning summary error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
