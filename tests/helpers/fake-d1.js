// A small in-memory stand-in for Cloudflare D1, on top of node:sqlite (Node 22+).
// Enough of the D1 API for src/worker/store.ts: prepare/bind/all/first/run and batch.
import { DatabaseSync } from 'node:sqlite';

const arg = v => (v instanceof ArrayBuffer ? new Uint8Array(v) : typeof v === 'boolean' ? Number(v) : v);

export function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  const statement = (query, params = []) => ({
    bind: (...p) => statement(query, p.map(arg)),
    async all() {
      return { results: sql.prepare(query).all(...params).map(r => ({ ...r })), success: true };
    },
    async first() {
      const r = sql.prepare(query).get(...params);
      return r ? { ...r } : null;
    },
    async run() {
      const r = sql.prepare(query).run(...params);
      return { success: true, meta: { changes: Number(r.changes) } };
    },
    exec() {
      // RETURNING statements report their rows; others report nothing.
      return /\bRETURNING\b/i.test(query) ? sql.prepare(query).all(...params).map(r => ({ ...r })) : (sql.prepare(query).run(...params), []);
    }
  });
  return {
    prepare: q => statement(q),
    async batch(stmts) {
      sql.exec('BEGIN');
      try {
        const out = stmts.map(s => ({ results: s.exec(), success: true }));
        sql.exec('COMMIT');
        return out;
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    }
  };
}
