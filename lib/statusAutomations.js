/**
 * What a lead status change kicks off. Called by setLeadStatus (lib/leads.js)
 * after the status is saved. Returns a short list of what happened, for the
 * dashboard to show.
 */

export async function runStatusAutomations(client, lead, { prev, now }) {
  return [];
}
