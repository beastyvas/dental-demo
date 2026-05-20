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
