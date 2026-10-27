import { supabase } from './supabase.js';

/** Look up a client by their Vapi assistant ID. Returns null if not found or inactive. */
export async function getClientByAgentId(agentId) {
  if (!agentId) return null;
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('agent_id', agentId)
    .eq('active', true)
    .single();
  if (error) return null;
  return data;
}

/** Look up a client by their primary key. Returns null if not found or inactive. */
export async function getClientById(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .eq('active', true)
    .single();
  if (error) return null;
  return data;
}

/** Returns all active clients ordered by business_name. */
export async function getAllActiveClients() {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('active', true)
    .order('business_name');
  if (error) {
    console.error('getAllActiveClients error:', error);
    return [];
  }
  return data ?? [];
}

/**
 * Make the phone line match clients.assistant_active. The switch works at the
 * phone-number level for onboarded clients: OFF detaches the assistant so Vapi
 * forwards every call to fallbackDestination (the owner); ON re-attaches it.
 * Clients without a Vapi number keep the old behavior (the prompt reads
 * assistantActive from checkOfficeHours). Returns true if the phone was
 * updated, null if there's no Vapi number. Throws if Vapi is unreachable.
 */
export async function syncAssistantPhone(clientId, active) {
  const { data: full } = await supabase.from('clients')
    .select('agent_id, vapi_phone_number_id, transfer_phone, owner_phone').eq('id', clientId).single();
  if (!full?.vapi_phone_number_id) return null;
  const { updatePhoneNumber } = await import('./vapi.js');
  const fallback = full.transfer_phone || full.owner_phone;
  await updatePhoneNumber(full.vapi_phone_number_id, active
    ? { assistantId: full.agent_id }
    : { assistantId: null, ...(fallback ? { fallbackDestination: { type: 'number', number: fallback } } : {}) });
  return true;
}
