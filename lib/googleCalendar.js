/**
 * Google Calendar API client using a service-account JWT.
 *
 * Auth: set GOOGLE_SERVICE_ACCOUNT_KEY (or GOOGLE_SERVICE_ACCOUNT_JSON) to
 * the full contents of the service account's JSON key file (paste the whole
 * JSON as one env var). The target calendar must be shared with that service
 * account's client_email with "Make changes to events" permission.
 */

import jwt from 'jsonwebtoken';

const TOKEN_URL    = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

let cachedToken = null; // { token, expiresAt }

function getCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error('[googleCalendar] Invalid GOOGLE_SERVICE_ACCOUNT_KEY/GOOGLE_SERVICE_ACCOUNT_JSON JSON:', err.message);
    return null;
  }
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const creds = getCredentials();
  if (!creds) throw new Error('Missing or invalid GOOGLE_SERVICE_ACCOUNT_KEY/GOOGLE_SERVICE_ACCOUNT_JSON env var');

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss:   creds.client_email,
      scope: 'https://www.googleapis.com/auth/calendar',
      aud:   TOKEN_URL,
      iat:   now,
      exp:   now + 3600,
    },
    creds.private_key,
    { algorithm: 'RS256' }
  );

  const r = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!r.ok) {
    throw new Error(`Google token exchange failed: ${r.status} ${await r.text()}`);
  }

  const data = await r.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

/**
 * Creates an event on the given calendar.
 *
 * Never throws — returns { ok: false, error } on any failure (missing
 * config, bad credentials, API error) so callers can treat calendar sync
 * as best-effort and never let it block a booking.
 */
export async function createCalendarEvent({ calendarId, summary, description, location, start, end, timezone }) {
  if (!calendarId) return { ok: false, error: 'No calendar_id configured for this client' };

  try {
    const token = await getAccessToken();

    const r = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary,
        description,
        location,
        start: { dateTime: start, timeZone: timezone },
        end:   { dateTime: end,   timeZone: timezone },
      }),
    });

    if (!r.ok) {
      return { ok: false, error: `Calendar API ${r.status}: ${await r.text()}` };
    }

    const data = await r.json();
    return { ok: true, eventId: data.id, htmlLink: data.htmlLink };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
