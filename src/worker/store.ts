import type { Change, ServerRecord, SyncResponse, SyncTable } from '../core/sync.ts';
import { PULL_PAGE } from '../core/sync.ts';

// Schema is applied lazily by the Worker itself (idempotent), so production
// and every preview database need no separate migration step.
const RECORDS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS records (
     tbl TEXT NOT NULL,
     id TEXT NOT NULL,
     survey_id TEXT,
     data TEXT NOT NULL,
     version INTEGER NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0,
     seq INTEGER NOT NULL,
     updated_at TEXT NOT NULL,
     updated_by TEXT NOT NULL,
     PRIMARY KEY (tbl, id)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS records_seq ON records(seq)`,
  `CREATE INDEX IF NOT EXISTS records_survey ON records(survey_id)`
];

const PHOTOS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS blobs (
     hash TEXT PRIMARY KEY,
     mime TEXT NOT NULL,
     size INTEGER NOT NULL,
     data BLOB NOT NULL,
     created_at TEXT NOT NULL,
     created_by TEXT NOT NULL
   )`
];

const ready = new WeakMap<D1Database, Promise<unknown>>();
function ensure(db: D1Database, statements: string[]) {
  let p = ready.get(db);
  if (!p) {
    p = db.batch(statements.map(s => db.prepare(s))).catch(e => {
      ready.delete(db);
      throw e;
    });
    ready.set(db, p);
  }
  return p;
}

interface Row {
  tbl: SyncTable;
  id: string;
  data: string;
  version: number;
  deleted: number;
  seq: number;
  updated_at: string;
  updated_by: string;
}

const toRecord = (r: Row): ServerRecord => ({
  table: r.tbl,
  id: r.id,
  version: r.version,
  deleted: !!r.deleted,
  seq: r.seq,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
  data: r.deleted ? null : JSON.parse(r.data)
});

export async function sync(
  db: D1Database,
  photos: D1Database,
  user: string,
  cursor: number,
  changes: Change[]
): Promise<SyncResponse> {
  await Promise.all([ensure(db, RECORDS_SCHEMA), ensure(photos, PHOTOS_SCHEMA)]);
  const res: SyncResponse = { applied: [], conflicts: [], rejected: [], changes: [], cursor, more: false };

  // Photo records may only reference blobs that were uploaded first.
  const hashes = [...new Set(changes.filter(c => c.table === 'photos' && !c.deleted).map(c => String(c.data!.hash)))];
  const present = new Set<string>();
  for (let i = 0; i < hashes.length; i += 50) {
    const part = hashes.slice(i, i + 50);
    const { results } = await photos
      .prepare(`SELECT hash FROM blobs WHERE hash IN (${part.map(() => '?').join(',')})`)
      .bind(...part)
      .all<{ hash: string }>();
    results.forEach(r => present.add(r.hash));
  }

  const accepted: Change[] = [];
  for (const c of changes) {
    if (c.table === 'photos' && !c.deleted && !present.has(String(c.data!.hash)))
      res.rejected.push({ table: c.table, id: c.id, reason: 'Снимката още не е качена.' });
    else accepted.push(c);
  }

  if (accepted.length) {
    const now = new Date().toISOString();
    // Insert, or update only if the client's base version is still current.
    // seq = MAX(seq)+1 is safe: a D1 batch runs as one serialized transaction.
    const stmt = db.prepare(
      `INSERT INTO records (tbl, id, survey_id, data, version, deleted, seq, updated_at, updated_by)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, (SELECT COALESCE(MAX(seq), 0) + 1 FROM records), ?6, ?7)
       ON CONFLICT (tbl, id) DO UPDATE SET
         survey_id = excluded.survey_id, data = excluded.data, deleted = excluded.deleted,
         version = records.version + 1, seq = excluded.seq,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by
       WHERE records.version = ?8
       RETURNING version`
    );
    const results = await db.batch<{ version: number }>(
      accepted.map(c => {
        const surveyId = c.table === 'surveys' ? c.id : String(c.data?.surveyId ?? '');
        return stmt.bind(c.table, c.id, surveyId || null, c.deleted ? '{}' : JSON.stringify(c.data), c.deleted ? 1 : 0, now, user, c.baseVersion);
      })
    );
    const lost: Change[] = [];
    results.forEach((r, i) => {
      const row = r.results?.[0];
      if (row) res.applied.push({ table: accepted[i].table, id: accepted[i].id, version: row.version });
      else lost.push(accepted[i]);
    });
    for (const c of lost) {
      const row = await db.prepare('SELECT * FROM records WHERE tbl = ? AND id = ?').bind(c.table, c.id).first<Row>();
      if (row) res.conflicts.push(toRecord(row));
    }
  }

  const { results } = await db
    .prepare('SELECT * FROM records WHERE seq > ? ORDER BY seq LIMIT ?')
    .bind(cursor, PULL_PAGE)
    .all<Row>();
  res.changes = results.map(toRecord);
  res.cursor = results.length ? results[results.length - 1].seq : cursor;
  res.more = results.length === PULL_PAGE;
  return res;
}

export async function putBlob(photos: D1Database, hash: string, mime: string, bytes: ArrayBuffer, user: string) {
  await ensure(photos, PHOTOS_SCHEMA);
  await photos
    .prepare('INSERT OR IGNORE INTO blobs (hash, mime, size, data, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(hash, mime, bytes.byteLength, bytes, new Date().toISOString(), user)
    .run();
}

export async function getBlob(photos: D1Database, hash: string) {
  await ensure(photos, PHOTOS_SCHEMA);
  const row = await photos.prepare('SELECT mime, data FROM blobs WHERE hash = ?').bind(hash).first<{ mime: string; data: ArrayBuffer | number[] }>();
  if (!row) return null;
  const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : Uint8Array.from(row.data);
  return { mime: row.mime, bytes };
}

export async function sha256Hex(bytes: ArrayBuffer) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
