/**
 * In-memory stand-in for the supabase-js query builder — just enough of the
 * chain (select/insert/upsert/update/delete + eq/is/gte/lte/neq/in/limit/order + single/
 * maybeSingle) for the handler tests. Await any chain to run it.
 */
import crypto from 'node:crypto';

export function createFakeDb(seed = {}) {
  const tables = structuredClone(seed);
  const t = (name) => (tables[name] ??= []);

  // "integrations->jobber->>account_id" style JSON paths, like PostgREST.
  const get = (r, k) => k.split(/->>?/).reduce((v, p) => (v == null ? v : v[p]), r);

  function builder(table) {
    const st = { op: 'select', filters: [], rows: null, limit: null, single: null, opts: {} };
    const match = (r) => st.filters.every((f) => f(r));
    const run = () => {
      const rows = t(table);
      let out;
      if (st.op === 'insert' || st.op === 'upsert') {
        out = st.rows.map((r) => {
          const keys = st.op === 'upsert' && st.opts.onConflict ? st.opts.onConflict.split(',') : null;
          const hit = keys && rows.find((x) => keys.every((k) => x[k] === r[k]));
          if (hit) return Object.assign(hit, r);
          const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r };
          rows.push(row);
          return row;
        });
      } else if (st.op === 'update') {
        out = rows.filter(match).map((r) => Object.assign(r, st.rows));
      } else if (st.op === 'delete') {
        out = rows.filter(match);
        tables[table] = rows.filter((r) => !match(r));
      } else {
        out = rows.filter(match);
      }
      if (st.limit != null) out = out.slice(0, st.limit);
      if (st.single === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'not single' } };
      if (st.single === 'maybe') return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    };
    const b = {
      select() { return b; },
      insert(rows) { st.op = 'insert'; st.rows = [].concat(rows); return b; },
      upsert(rows, opts = {}) { st.op = 'upsert'; st.rows = rows; st.opts = opts; return b; },
      update(vals) { st.op = 'update'; st.rows = vals; return b; },
      delete() { st.op = 'delete'; return b; },
      eq(k, v) { st.filters.push((r) => get(r, k) === v); return b; },
      is(k, v) { st.filters.push((r) => (r[k] ?? null) === v); return b; },
      gte(k, v) { st.filters.push((r) => r[k] >= v); return b; },
      lte(k, v) { st.filters.push((r) => r[k] <= v); return b; },
      neq(k, v) { st.filters.push((r) => r[k] !== v); return b; },
      in(k, vs) { st.filters.push((r) => vs.includes(get(r, k))); return b; },
      order() { return b; },
      limit(n) { st.limit = n; return b; },
      single() { st.single = 'single'; return b; },
      maybeSingle() { st.single = 'maybe'; return b; },
      then(res, rej) { try { res(run()); } catch (e) { rej(e); } },
    };
    return b;
  }

  return { supabase: { from: builder }, tables };
}
