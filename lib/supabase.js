import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

// Service-role client — bypasses RLS, only used server-side
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Insert that survives a column the database doesn't have yet (code deployed
 * before its migration ran): retries once without the optional columns.
 */
export async function insertTolerant(table, row, optionalColumns = [], { select = false } = {}) {
  const run = (r) => {
    const q = supabase.from(table).insert([r]);
    return select ? q.select().single() : q;
  };
  let result = await run(row);
  const missing = result.error && optionalColumns.find((c) => String(result.error.message).includes(c));
  if (missing) {
    console.warn(`[supabase] ${table}.${missing} missing — run the latest sql/ migration. Retrying without it.`);
    const stripped = { ...row };
    for (const c of optionalColumns) delete stripped[c];
    result = await run(stripped);
  }
  return result;
}
