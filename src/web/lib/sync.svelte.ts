import type { Change, ServerRecord, SyncResponse, SyncTable } from '../../core/sync.ts';
import { MAX_CHANGES_PER_REQUEST, stripLocal } from '../../core/sync.ts';
import type { Photo } from '../../core/model.ts';
import { db, onLocalChange, type OutboxEntry } from './db.ts';

// Sync engine: push the outbox, pull everything newer than our cursor.
// Runs after local edits (debounced), when the device comes online, every
// minute while the app is visible, and on demand.

export type SyncState = 'idle' | 'syncing' | 'offline' | 'auth' | 'error' | 'unavailable';

export const sync = $state({
  state: 'idle' as SyncState,
  pending: 0,
  conflicts: 0,
  lastSync: '' as string,
  error: ''
});

class AuthNeeded extends Error {}
class Unavailable extends Error {}

async function api(path: string, init?: RequestInit) {
  // redirect: 'manual' — an expired Cloudflare Access session answers with a
  // redirect to the login page instead of JSON.
  const res = await fetch('/api' + path, { ...init, redirect: 'manual', credentials: 'same-origin' });
  if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) throw new AuthNeeded();
  if (res.status === 404 && res.headers.get('content-type')?.includes('text/html')) throw new Unavailable();
  return res;
}

async function sha256Hex(blob: Blob) {
  const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export { sha256Hex };

/** Compare two versions of a record, ignoring bookkeeping fields. */
function sameData(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined) {
  if (!a || !b) return !a && !b;
  const clean = (r: Record<string, unknown>) => {
    const x = stripLocal(r);
    delete x.updatedAt;
    return JSON.stringify(Object.keys(x).sort().map(k => [k, x[k]]));
  };
  return clean(a) === clean(b);
}

async function refreshCounts() {
  const [pending, conflicts] = await Promise.all([db.outbox.count(), db.conflicts.count()]);
  sync.pending = pending;
  sync.conflicts = conflicts;
}

/** Upload photo blobs that are queued and not on the server yet. */
async function uploadPhotos(entries: OutboxEntry[]) {
  for (const e of entries) {
    if (e.table !== 'photos' || e.deleted) continue;
    const p = await db.photos.get(e.id);
    if (!p?.blob || p.uploaded) continue;
    if (!p.hash) {
      p.hash = await sha256Hex(p.blob);
      p.mime = p.blob.type || 'image/jpeg';
      await db.photos.update(p.id, { hash: p.hash, mime: p.mime });
    }
    const res = await api('/blobs/' + p.hash, { method: 'PUT', headers: { 'Content-Type': p.mime || 'image/jpeg' }, body: p.blob });
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Снимката не можа да се качи.');
    await db.photos.update(p.id, { uploaded: true });
  }
}

async function applyResponse(sent: OutboxEntry[], r: SyncResponse) {
  const sentBy = new Map(sent.map(e => [e.table + ':' + e.id, e]));
  const tables = [db.surveys, db.floors, db.rooms, db.racks, db.devices, db.cables, db.photos, db.outbox, db.conflicts, db.kv];
  await db.transaction('rw', tables, async () => {
    // 1. Our changes the server accepted.
    for (const a of r.applied) {
      const s = sentBy.get(a.table + ':' + a.id);
      const entry = await db.outbox.get([a.table, a.id]);
      const t = db.table(a.table);
      if (await t.get(a.id)) await t.update(a.id, { version: a.version });
      if (entry && s && entry.queuedAt === s.queuedAt) await db.outbox.delete([a.table, a.id]);
      else if (entry) await db.outbox.put({ ...entry, baseVersion: a.version }); // edited again meanwhile
    }

    // 2. Ours lost the race: someone changed the record after our base version.
    for (const srv of r.conflicts) await resolveOrRecord(srv);

    // 3. Everything new on the server.
    for (const srv of r.changes) {
      const entry = await db.outbox.get([srv.table, srv.id]);
      if (entry) {
        if (srv.version > entry.baseVersion) await resolveOrRecord(srv);
        continue;
      }
      const t = db.table(srv.table);
      const local = (await t.get(srv.id)) as { version?: number } | undefined;
      if (local && (local.version ?? 0) >= srv.version) continue;
      if (srv.deleted) {
        await t.delete(srv.id);
      } else {
        const next: Record<string, unknown> = { ...srv.data, version: srv.version };
        if (srv.table === 'photos') {
          const lp = local as Photo | undefined;
          if (lp?.blob && lp.hash === srv.data?.hash) Object.assign(next, { blob: lp.blob, uploaded: true });
          else next.uploaded = true;
        }
        await t.put(next);
      }
    }
    await db.kv.put({ key: 'cursor', value: r.cursor });
  });
}

/** A concurrent change: settle it automatically when both sides agree, otherwise ask the user. */
async function resolveOrRecord(srv: ServerRecord) {
  const t = db.table(srv.table);
  const entry = await db.outbox.get([srv.table, srv.id]);
  const local = (await t.get(srv.id)) as Record<string, unknown> | undefined;
  const agree = entry?.deleted ? srv.deleted : !srv.deleted && sameData(local, srv.data);
  if (agree) {
    if (local) await t.update(srv.id, { version: srv.version });
    await db.outbox.delete([srv.table, srv.id]);
    await db.conflicts.delete([srv.table, srv.id]);
    return;
  }
  await db.conflicts.put({ table: srv.table, id: srv.id, server: srv, at: new Date().toISOString() });
}

/** Keep my version: re-send it on top of the server's current version. */
export async function keepMine(table: SyncTable, id: string) {
  await db.transaction('rw', [db.outbox, db.conflicts], async () => {
    const c = await db.conflicts.get([table, id]);
    const e = await db.outbox.get([table, id]);
    if (c && e) await db.outbox.put({ ...e, baseVersion: c.server.version, queuedAt: Date.now() });
    await db.conflicts.delete([table, id]);
  });
  requestSync();
}

/** Take the server's version and drop my unsent edit. */
export async function takeServer(table: SyncTable, id: string) {
  const t = db.table(table);
  await db.transaction('rw', [t, db.outbox, db.conflicts], async () => {
    const c = await db.conflicts.get([table, id]);
    if (!c) return;
    if (c.server.deleted) await t.delete(id);
    else {
      const local = (await t.get(id)) as Photo | undefined;
      const keep = table === 'photos' && local?.blob && local.hash === c.server.data?.hash ? { blob: local.blob, uploaded: true } : {};
      await t.put({ ...c.server.data, ...keep, version: c.server.version });
    }
    await db.outbox.delete([table, id]);
    await db.conflicts.delete([table, id]);
  });
  await refreshCounts();
}

let running: Promise<void> | null = null;
let again = false;

export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await runOnce();
    } while (again && sync.state === 'idle');
  })().finally(() => (running = null));
  return running;
}

async function runOnce() {
  if (!navigator.onLine) {
    sync.state = 'offline';
    await refreshCounts();
    return;
  }
  sync.state = 'syncing';
  sync.error = '';
  try {
    for (let round = 0; round < 20; round++) {
      const blocked = new Set((await db.conflicts.toArray()).map(c => c.table + ':' + c.id));
      const entries = (await db.outbox.orderBy('queuedAt').toArray())
        .filter(e => !blocked.has(e.table + ':' + e.id))
        .slice(0, MAX_CHANGES_PER_REQUEST);
      await uploadPhotos(entries);

      const changes: Change[] = [];
      for (const e of entries) {
        if (e.deleted) {
          changes.push({ table: e.table, id: e.id, baseVersion: e.baseVersion, deleted: true, data: null });
          continue;
        }
        const rec = await db.table(e.table).get(e.id);
        if (!rec) {
          await db.outbox.delete([e.table, e.id]); // removed locally without a tombstone
          continue;
        }
        changes.push({ table: e.table, id: e.id, baseVersion: e.baseVersion, deleted: false, data: stripLocal(rec) });
      }
      const cursor = ((await db.kv.get('cursor'))?.value as number | undefined) ?? 0;
      const res = await api('/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cursor, changes })
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Сървърът върна ${res.status}.`);
      const body = (await res.json()) as SyncResponse;
      const sent = entries.filter(e => changes.some(c => c.table === e.table && c.id === e.id));
      await applyResponse(sent, body);
      if (body.rejected.length) sync.error = body.rejected[0].reason;

      const remaining = (await db.outbox.count()) - (await db.conflicts.count());
      const progressed = body.applied.length > 0 || body.changes.length > 0;
      if (!body.more && (remaining <= body.rejected.length || !progressed)) break;
    }
    sync.state = 'idle';
    sync.lastSync = new Date().toISOString();
  } catch (e) {
    if (e instanceof AuthNeeded) sync.state = 'auth';
    else if (e instanceof Unavailable) sync.state = 'unavailable';
    else {
      sync.state = navigator.onLine ? 'error' : 'offline';
      sync.error = (e as Error).message;
    }
  } finally {
    await refreshCounts();
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** Debounced sync after local edits. */
export function requestSync(delay = 1500) {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), delay);
  refreshCounts();
}

/** Download a photo another device took. */
export async function fetchPhotoBlob(p: Photo) {
  if (p.blob || !p.hash || !navigator.onLine) return;
  try {
    const res = await api('/blobs/' + p.hash);
    if (!res.ok) return;
    const blob = await res.blob();
    await db.photos.update(p.id, { blob, uploaded: true });
  } catch {
    /* try again next time the photo is shown */
  }
}

export function startSync() {
  onLocalChange(() => requestSync());
  addEventListener('online', () => syncNow());
  addEventListener('offline', () => (sync.state = 'offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') syncNow();
  }, 60_000);
  syncNow();
}
