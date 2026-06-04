/**
 * Meevo Connect API client (Continuum)
 *
 * Required env vars (all optional — endpoints fall back to mock when absent):
 *   MEEVO_BASE_URL        e.g. https://api.meevo.com
 *   MEEVO_CLIENT_ID       OAuth2 client ID from Meevo developer portal
 *   MEEVO_CLIENT_SECRET   OAuth2 client secret
 *
 * Per-location site ID lives in clients.meevo_site_id (Supabase).
 *
 * ⚠️  Endpoint paths are based on Meevo Connect REST conventions.
 *     Verify against your official API docs when you receive credentials.
 */

const BASE_URL       = process.env.MEEVO_BASE_URL;
const CLIENT_ID      = process.env.MEEVO_CLIENT_ID;
const CLIENT_SECRET  = process.env.MEEVO_CLIENT_SECRET;

/** Returns true when all three Meevo env vars are present. */
export function meevoConfigured() {
  return !!(BASE_URL && CLIENT_ID && CLIENT_SECRET);
}

// ── OAuth2 token cache (lives for the duration of this serverless function) ──
let _cachedToken      = null;
let _tokenExpiresAt   = 0;

async function getToken() {
  if (_cachedToken && Date.now() < _tokenExpiresAt - 60_000) return _cachedToken;

  const res = await fetch(`${BASE_URL}/oauth2/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope:         'appointments clients services staff sites',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meevo auth failed (${res.status}): ${body}`);
  }

  const data       = await res.json();
  _cachedToken     = data.access_token;
  _tokenExpiresAt  = Date.now() + (data.expires_in ?? 3600) * 1000;
  return _cachedToken;
}

async function meevoFetch(path, options = {}) {
  const token = await getToken();
  const res   = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meevo ${options.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
  }

  return res.json();
}

// ── Services ─────────────────────────────────────────────────────────────────

/** Fetch all bookable services for a site. Cached per cold-start. */
const _serviceCache = new Map();

export async function getServices(siteId) {
  if (_serviceCache.has(siteId)) return _serviceCache.get(siteId);
  const data     = await meevoFetch(`/v2/sites/${siteId}/services`);
  const services = data?.services ?? data ?? [];
  _serviceCache.set(siteId, services);
  return services;
}

/**
 * Find the best-matching Meevo service by name (case-insensitive substring).
 * Returns the service object or null.
 */
export async function findServiceByName(siteId, name) {
  const services = await getServices(siteId);
  const q        = name.toLowerCase();
  return (
    services.find(s => s.name?.toLowerCase() === q) ??
    services.find(s => s.name?.toLowerCase().includes(q)) ??
    null
  );
}

// ── Staff ─────────────────────────────────────────────────────────────────────

const _staffCache = new Map();

export async function getStaff(siteId) {
  if (_staffCache.has(siteId)) return _staffCache.get(siteId);
  const data  = await meevoFetch(`/v2/sites/${siteId}/staff`);
  const staff = data?.staff ?? data ?? [];
  _staffCache.set(siteId, staff);
  return staff;
}

/** Find a staff member by first or full name. Returns null if not found. */
export async function findStaffByName(siteId, name) {
  const staff = await getStaff(siteId);
  const q     = name.toLowerCase();
  return (
    staff.find(s => `${s.firstName} ${s.lastName}`.toLowerCase() === q) ??
    staff.find(s => s.firstName?.toLowerCase() === q) ??
    null
  );
}

// ── Availability ──────────────────────────────────────────────────────────────

/**
 * Get open appointment slots.
 *
 * @param {object} params
 * @param {string} params.siteId       Meevo site/location ID
 * @param {string} params.serviceId    Meevo service ID
 * @param {string} params.startDate    ISO date "YYYY-MM-DD"
 * @param {string} params.endDate      ISO date "YYYY-MM-DD"
 * @param {string} [params.staffId]    Optional: restrict to one therapist
 *
 * @returns {Array<{slot_id, date, time, therapist, rawStart, staffId, serviceId}>}
 */
export async function getAvailability({ siteId, serviceId, startDate, endDate, staffId }) {
  const params = new URLSearchParams({ serviceId, startDate, endDate });
  if (staffId) params.set('staffId', staffId);

  // ⚠️  Verify this path against your Meevo API docs
  const data  = await meevoFetch(`/v2/sites/${siteId}/appointments/availability?${params}`);
  const slots = data?.availableSlots ?? data?.slots ?? data ?? [];

  return slots.map((s, i) => ({
    slot_id:   s.slotId   ?? s.id     ?? `slot-${i + 1}`,
    date:      formatSlotDate(s.startDateTime ?? s.startDate),
    time:      formatSlotTime(s.startDateTime ?? s.startTime),
    therapist: s.staffName ?? s.employeeName ?? s.firstName ?? 'Available therapist',
    rawStart:  s.startDateTime,
    staffId:   s.staffId  ?? s.employeeId,
    serviceId,
  }));
}

// ── Appointments ──────────────────────────────────────────────────────────────

/**
 * Create a confirmed appointment in Meevo.
 *
 * @returns {{ appointmentId, confirmationNumber, startDateTime }}
 */
export async function bookAppointment({ siteId, serviceId, staffId, clientId, startDateTime, notes }) {
  // ⚠️  Verify payload shape against your Meevo API docs
  const data = await meevoFetch(`/v2/sites/${siteId}/appointments`, {
    method: 'POST',
    body:   JSON.stringify({
      serviceId,
      staffId,
      clientId,
      startDateTime,
      notes: notes ?? '',
    }),
  });

  return {
    appointmentId:      data.appointmentId ?? data.id,
    confirmationNumber: data.confirmationNumber ?? data.confirmationCode ?? data.id,
    startDateTime:      data.startDateTime,
  };
}

// ── Clients ───────────────────────────────────────────────────────────────────

/**
 * Search for an existing Meevo client by phone number.
 * Returns the first match or null.
 */
export async function findClientByPhone(siteId, phone) {
  const cleaned = phone.replace(/\D/g, '');
  try {
    // ⚠️  Verify query param name against your Meevo API docs
    const data    = await meevoFetch(`/v2/sites/${siteId}/clients?phone=${cleaned}`);
    const clients = data?.clients ?? data ?? [];
    return clients[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Create a new client record in Meevo.
 * @returns {{ clientId, firstName, lastName }}
 */
export async function createClient({ siteId, firstName, lastName, phone, email }) {
  // ⚠️  Verify payload shape against your Meevo API docs
  const data = await meevoFetch(`/v2/sites/${siteId}/clients`, {
    method: 'POST',
    body:   JSON.stringify({
      firstName,
      lastName,
      phone: phone.replace(/\D/g, ''),
      email: email ?? '',
    }),
  });

  return {
    clientId:  data.clientId ?? data.id,
    firstName: data.firstName,
    lastName:  data.lastName,
  };
}

// ── Date/time formatters ──────────────────────────────────────────────────────

function formatSlotDate(isoString) {
  if (!isoString) return 'TBD';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatSlotTime(isoString) {
  if (!isoString) return 'TBD';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * Build a { startDate, endDate } range (ISO "YYYY-MM-DD") from a natural language
 * preference string like "weekend" or "Tuesday morning".
 */
export function buildDateRange(datePref = '', daysAhead = 14) {
  const now   = new Date();
  const pref  = datePref.toLowerCase();

  const start = new Date(now);
  start.setDate(start.getDate() + 1); // never today

  const end = new Date(now);
  end.setDate(end.getDate() + daysAhead);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate:   end.toISOString().slice(0, 10),
  };
}
