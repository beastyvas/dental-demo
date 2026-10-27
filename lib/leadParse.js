/**
 * Turns a lead-notification email (Angi, Thumbtack, Facebook lead ads, or
 * anything an owner forwards) into { source, name, phone, email, message }.
 *
 * Lead services change their email layouts, so this reads labeled lines
 * ("Name: …", "Phone Number: …") first and falls back to the first phone /
 * email in the body. The raw email is kept on the lead so a bad parse can be
 * fixed by hand and the parser tuned on real examples.
 */

import { toE164 } from './phone.js';

const SENDERS = [
  { source: 'angi',      match: /angi\.com|angieslist|homeadvisor/i },
  { source: 'thumbtack', match: /thumbtack/i },
  { source: 'meta',      match: /facebookmail\.com|facebook\.com|\bmeta\b|instagram/i },
];

const LABELS = {
  name:    /^(?:customer|client|lead|contact|full)?\s*name\s*[:\-–]\s*(.+)$/im,
  first:   /^first\s*name\s*[:\-–]\s*(.+)$/im,
  last:    /^last\s*name\s*[:\-–]\s*(.+)$/im,
  phone:   /^(?:phone|phone number|mobile|cell|telephone|tel)\s*[:\-–]\s*(.+)$/im,
  email:   /^(?:e-?mail|email address)\s*[:\-–]\s*(\S+@\S+)/im,
  message: /^(?:message|details|project details|project|description|job description|comments|notes|service requested|request|service)\s*[:\-–]\s*(.+(?:\n(?![A-Z][\w ]{1,30}:).+){0,6})/im,
};

// "Mike Jones wants a quote", "New lead: Mike Jones", "New message from Mike Jones"
const SUBJECT_NAME = [
  /^(?:fwd?:\s*)?(?:new (?:lead|request|message|customer)(?: from)?[:\s-]+)([A-Z][\w'.-]+(?: [A-Z][\w'.-]+){0,2})/i,
  /^(?:fwd?:\s*)?([A-Z][\w'.-]+(?: [A-Z][\w'.-]+){0,2}) (?:wants|requested|is requesting|sent you|needs)/,
];

const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const NOREPLY = /no-?reply|donotreply|notifications?@|@(?:angi|thumbtack|homeadvisor|facebookmail|facebook|leads\.)/i;

export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ': ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/:\s*:/g, ':')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

const tidy = (s, max = 2000) => (s ? String(s).replace(/\s+/g, ' ').trim().slice(0, max) || null : null);

/** @param {{ from?: string, to?: string, subject?: string, text?: string, html?: string }} mail */
export function parseLeadEmail(mail, { ignorePhones = [] } = {}) {
  const from = String(mail.from ?? '');
  const subject = String(mail.subject ?? '');
  const body = (mail.text && mail.text.trim()) ? String(mail.text) : htmlToText(mail.html);
  // A forwarded email: the original sender shows up in the body.
  const fwdFrom = body.match(/^From:\s*(.+)$/im)?.[1] ?? '';
  const source = SENDERS.find((s) => s.match.test(from) || s.match.test(fwdFrom) || s.match.test(subject))?.source ?? 'email';

  const label = (k) => body.match(LABELS[k])?.[1]?.trim() ?? null;

  let name = label('name');
  if (!name && (label('first') || label('last'))) name = [label('first'), label('last')].filter(Boolean).join(' ');
  if (!name) for (const re of SUBJECT_NAME) { const m = subject.match(re); if (m) { name = m[1]; break; } }

  // Labeled phones first, then any number in the body — skipping the
  // business's own lines, which these emails often include.
  const skip = new Set(ignorePhones.map(toE164).filter(Boolean));
  const labeled = [...body.matchAll(new RegExp(LABELS.phone.source, 'gim'))].map((m) => m[1]);
  const anywhere = [...body.matchAll(PHONE_RE)].map((m) => m[0]);
  const phone = [...labeled, ...anywhere].map(toE164).find((e) => e && !skip.has(e)) ?? null;

  let email = label('email');
  if (!email) email = [...body.matchAll(EMAIL_RE)].map((m) => m[0]).find((e) => !NOREPLY.test(e)) ?? null;

  const message = label('message');

  return {
    source,
    name: tidy(name, 120),
    phone,
    email: email && !NOREPLY.test(email) ? email.toLowerCase() : null,
    message: tidy(message) ?? tidy(subject.replace(/^fwd?:\s*/i, ''), 200),
  };
}

/** "desert-air.k7f3a9c2@leads.nickbuilds.org" → { slug: 'desert-air', key: 'k7f3a9c2' } */
export function parseLeadAddress(to) {
  const addr = String(to ?? '').match(/<?([^<>\s,]+)@/)?.[1] ?? '';
  const m = addr.toLowerCase().match(/^([a-z0-9-]+)\.([a-z0-9]{8,})$/);
  return m ? { slug: m[1], key: m[2] } : null;
}

/** The address a client forwards lead emails to. */
export function leadEmailAddress(client) {
  const domain = process.env.LEAD_EMAIL_DOMAIN;
  if (!domain || !client?.lead_key) return null;
  return `${client.slug}.${client.lead_key.slice(0, 10).toLowerCase()}@${domain}`;
}
