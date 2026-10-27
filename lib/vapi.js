/**
 * Minimal Vapi REST API client + webhook guard.
 * Multi-tenant: agent ID check removed from verifyVapiRequest — each endpoint
 * now resolves the client from the assistantId in the request body.
 */

const BASE = 'https://api.vapi.ai';

function headers() {
  const key = process.env.VAPI_API_KEY;
  if (!key) throw new Error('Missing VAPI_API_KEY env var');
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

/** GET /assistant/{id} — returns current assistant config */
export async function getAssistant(id) {
  const r = await fetch(`${BASE}/assistant/${id}`, { headers: headers() });
  if (!r.ok) throw new Error(`Vapi GET /assistant/${id} failed: ${r.status} ${await r.text()}`);
  return r.json();
}

/**
 * Webhook guard — validates the shared secret header on every Vapi tool call.
 * Returns true if valid, or sends 401 and returns false.
 *
 * Note: per-client agent ID validation is handled by getClientByAgentId()
 * inside each tool endpoint, so we don't check VAPI_AGENT_ID here.
 */
export function verifyVapiRequest(req, res) {
  const secret = req.headers['x-vapi-secret'];
  if (secret !== process.env.VAPI_WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

/** PATCH /assistant/{id} — partial update (deep-merges nested objects) */
export async function updateAssistant(id, body) {
  const r = await fetch(`${BASE}/assistant/${id}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Vapi PATCH /assistant/${id} failed: ${r.status} ${await r.text()}`);
  return r.json();
}

/** PATCH /phone-number/{id} — e.g. detach the assistant so calls go to fallbackDestination. */
export async function updatePhoneNumber(id, body) {
  const r = await fetch(`${BASE}/phone-number/${id}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Vapi PATCH /phone-number/${id} failed: ${r.status} ${await r.text()}`);
  return r.json();
}

/** POST /assistant — create a new assistant. */
export async function createAssistant(body) {
  const r = await fetch(`${BASE}/assistant`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Vapi POST /assistant failed: ${r.status} ${await r.text()}`);
  return r.json();
}

/** POST /phone-number — import a number (e.g. a Twilio one) into Vapi. */
export async function createPhoneNumber(body) {
  const r = await fetch(`${BASE}/phone-number`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Vapi POST /phone-number failed: ${r.status} ${await r.text()}`);
  return r.json();
}

/** POST /call — the AI places an outbound call (speed-to-lead callback). */
export async function createCall(body) {
  const r = await fetch(`${BASE}/call`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Vapi POST /call failed: ${r.status} ${await r.text()}`);
  return r.json();
}
