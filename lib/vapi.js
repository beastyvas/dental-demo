/**
 * Minimal Vapi REST API client.
 * Used by scripts/vapi-setup.js to push config to the agent.
 * All calls require VAPI_API_KEY (different from VAPI_WEBHOOK_SECRET).
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
 * Webhook guard — call at the top of any Vapi tool endpoint.
 * Verifies the shared secret AND that the call came from our specific agent.
 * Returns true if valid, or sends a 401/403 and returns false.
 */
export function verifyVapiRequest(req, res) {
  // 1. Shared secret check (primary auth)
  const secret = req.headers['x-vapi-secret'];
  if (secret !== process.env.VAPI_WEBHOOK_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }

  // 2. Agent ID check (secondary — only enforced when the env var is set)
  const expectedId = process.env.VAPI_AGENT_ID;
  if (expectedId) {
    const callerId = req.body?.message?.call?.assistantId;
    // callerId may be absent on direct/test POSTs — only reject if explicitly wrong
    if (callerId && callerId !== expectedId) {
      console.warn(`[vapi] Rejected request from unexpected assistantId: ${callerId}`);
      res.status(403).json({ error: 'Forbidden' });
      return false;
    }
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
