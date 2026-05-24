/**
 * GET /api/cron/morning-summary
 * Vercel cron — runs at 8:00 AM Las Vegas time Mon–Sat.
 * Schedule in vercel.json: "0 15 * * 1-6"
 *   (15:00 UTC = 8:00 AM PDT, Apr–Oct)
 *
 * Multi-tenant: loops all active clients, sends each a categorized SMS recap.
 * Categories: Meevo bookings, new members, after-hours requests, urgents.
 */

import { supabase }             from '../../lib/supabase.js';
import { sendSMS }              from '../../lib/sms.js';
import { formatInTZ, TIMEZONE } from '../../lib/timezone.js';
import { getAllActiveClients }   from '../../lib/clients.js';

// Classify an entry by what's in its notes
function classify(entry) {
  const notes = (entry.notes ?? '').toUpperCase();
  if (entry.priority === 'urgent')       return 'urgent';
  if (notes.includes('CONFIRMED VIA AI')) return 'booked';
  if (notes.includes('NEW MEMBER'))      return 'new_member';
  if (notes.includes('AFTER HOURS'))     return 'after_hours';
  if (notes.includes('CARD ON FILE'))    return 'card_required';
  return 'callback';
}

function fmt(entry) {
  return `${entry.patient_name} — ${entry.service_needed || 'service TBD'} | 📞 ${entry.phone}`;
}

function buildSMS(client, entries) {
  const booked      = entries.filter(e => classify(e) === 'booked');
  const newMembers  = entries.filter(e => classify(e) === 'new_member');
  const afterHours  = entries.filter(e => classify(e) === 'after_hours');
  const cardNeeded  = entries.filter(e => classify(e) === 'card_required');
  const callbacks   = entries.filter(e => classify(e) === 'callback');
  const urgents     = entries.filter(e => classify(e) === 'urgent');

  let msg = `Good morning! Overnight recap for ${client.business_name}:\n\n`;

  if (booked.length > 0) {
    msg += `✅ MEEVO BOOKINGS (${booked.length}):\n`;
    booked.forEach((e, i) => {
      // Pull conf# and slot from notes if present
      const confMatch = (e.notes ?? '').match(/Conf#:\s*([A-Z0-9-]+)/i);
      const conf = confMatch ? ` | ${confMatch[1]}` : '';
      msg += `${i + 1}. ${e.patient_name} — ${e.service_needed}${conf}\n`;
      msg += `   Slot: ${e.preferred_days || '—'} | 📞 ${e.phone}\n`;
    });
    msg += '\n';
  }

  if (newMembers.length > 0) {
    msg += `🆕 NEW MEMBERS — NEED SETUP (${newMembers.length}):\n`;
    newMembers.forEach((e, i) => msg += `${i + 1}. ${fmt(e)}\n`);
    msg += '\n';
  }

  if (afterHours.length > 0) {
    msg += `🌙 AFTER-HOURS REQUESTS (${afterHours.length}):\n`;
    afterHours.forEach((e, i) => msg += `${i + 1}. ${fmt(e)}\n`);
    msg += '\n';
  }

  if (cardNeeded.length > 0) {
    msg += `💳 CARD ON FILE MISSING (${cardNeeded.length}):\n`;
    cardNeeded.forEach((e, i) => msg += `${i + 1}. ${fmt(e)}\n`);
    msg += '\n';
  }

  if (callbacks.length > 0) {
    msg += `📋 CALLBACKS NEEDED (${callbacks.length}):\n`;
    callbacks.forEach((e, i) => msg += `${i + 1}. ${fmt(e)}\n`);
    msg += '\n';
  }

  if (urgents.length > 0) {
    msg += `🚨 URGENT (${urgents.length}):\n`;
    urgents.forEach((e, i) => msg += `${i + 1}. ${fmt(e)}\n`);
    msg += '\n';
  }

  const attention = newMembers.length + afterHours.length + cardNeeded.length + urgents.length;
  msg += `Total: ${entries.length} overnight interaction${entries.length !== 1 ? 's' : ''}`;
  if (attention > 0) msg += ` · ⚠️ ${attention} need${attention === 1 ? 's' : ''} attention`;
  msg += `\n— Virtual Receptionist`;

  return msg;
}

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
        .order('created_at', { ascending: true });

      if (error) {
        console.error(`[morning-summary] Supabase error for ${client.slug}:`, error);
        results.push({ slug: client.slug, error: 'db_error' });
        continue;
      }

      if (!entries || entries.length === 0) {
        await sendSMS(
          client.front_desk_phone,
          `Good morning! No overnight activity for ${client.business_name}. Have a great day! — Virtual Receptionist`
        );
        results.push({ slug: client.slug, entryCount: 0 });
        continue;
      }

      const msg = buildSMS(client, entries);
      await sendSMS(client.front_desk_phone, msg);

      // Mark all as contacted
      await supabase
        .from('waitlist')
        .update({ contacted: true })
        .in('id', entries.map(e => e.id));

      console.log(`[${formatInTZ(new Date(), {}, tz)}] Morning summary sent — ${client.slug}: ${entries.length} entries`);
      results.push({ slug: client.slug, entryCount: entries.length });
    }

    return res.status(200).json({ results });
  } catch (err) {
    console.error('Morning summary error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
