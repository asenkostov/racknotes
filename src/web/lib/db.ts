import Dexie, { type EntityTable, type Transaction } from 'dexie';
import type { Device, Floor, Photo, Rack, Room, Survey } from '../../core/model.ts';
import { now } from '../../core/model.ts';
import type { ServerRecord, SyncTable } from '../../core/sync.ts';
import { SYNC_TABLES } from '../../core/sync.ts';

/** A local change waiting to be sent to the server. */
export interface OutboxEntry {
  table: SyncTable;
  id: string;
  deleted: boolean;
  /** Server version the local edit is based on. */
  baseVersion: number;
  /** Changes on every local edit; lets a sync ack tell whether the record was edited again meanwhile. */
  queuedAt: number;
}

/** A record someone else changed while this device had unsent edits to it. */
export interface Conflict {
  table: SyncTable;
  id: string;
  server: ServerRecord;
  at: string;
}

/** Local, offline store. Everything the field person enters lives here first. */
export class RackDb extends Dexie {
  surveys!: EntityTable<Survey, 'id'>;
  floors!: EntityTable<Floor, 'id'>;
  rooms!: EntityTable<Room, 'id'>;
  racks!: EntityTable<Rack, 'id'>;
  devices!: EntityTable<Device, 'id'>;
  photos!: EntityTable<Photo, 'id'>;
  outbox!: Dexie.Table<OutboxEntry, [string, string]>;
  conflicts!: Dexie.Table<Conflict, [string, string]>;
  kv!: Dexie.Table<{ key: string; value: unknown }, string>;

  constructor(name = 'racknotes') {
    super(name);
    const v1 = {
      surveys: 'id, updatedAt, status',
      floors: 'id, surveyId',
      rooms: 'id, surveyId, floorId',
      racks: 'id, surveyId, roomId',
      devices: 'id, surveyId, rackId, status',
      photos: 'id, surveyId, [ownerKind+ownerId]'
    };
    this.version(1).stores(v1);
    this.version(2)
      .stores({ ...v1, outbox: '[table+id], queuedAt', conflicts: '[table+id]', kv: 'key' })
      .upgrade(async tx => {
        // Everything entered before sync existed is queued once, so it reaches the server.
        let n = Date.now();
        for (const t of SYNC_TABLES) {
          const rows = await tx.table(t).toArray();
          await tx.table('outbox').bulkPut(rows.map(r => ({ table: t, id: r.id, deleted: false, baseVersion: 0, queuedAt: n++ })));
        }
      });
  }
}

export const db = new RackDb();

let stamp = 0;
const nextStamp = () => (stamp = Math.max(stamp + 1, Date.now()));

/** Listeners (the sync engine) are told when something was queued. */
const listeners = new Set<() => void>();
export const onLocalChange = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const notify = () => listeners.forEach(fn => fn());

async function enqueue(table: SyncTable, id: string, deleted: boolean, version: number | undefined) {
  const existing = await db.outbox.get([table, id]);
  await db.outbox.put({ table, id, deleted, baseVersion: existing?.baseVersion ?? version ?? 0, queuedAt: nextStamp() });
}

/** Save a record locally, queue it for sync and bump the parent survey's local timestamp. */
export async function save<T extends { id: string; updatedAt: string; version?: number; surveyId?: string }>(
  table: SyncTable,
  record: T
): Promise<T> {
  const t = now();
  const next = { ...record, updatedAt: t };
  await db.transaction('rw', [db.table(table), db.surveys, db.outbox], async () => {
    await db.table(table).put(next);
    await enqueue(table, next.id, false, next.version);
    const sid = table === 'surveys' ? undefined : next.surveyId;
    if (sid) await db.surveys.update(sid, { updatedAt: t });
  });
  notify();
  return next;
}

/** Delete records locally and queue tombstones so other devices delete them too. */
async function removeAll(table: SyncTable, rows: { id: string; version?: number }[]) {
  for (const r of rows) await enqueue(table, r.id, true, r.version);
  await db.table(table).bulkDelete(rows.map(r => r.id));
}

const allTables = () => [db.surveys, db.floors, db.rooms, db.racks, db.devices, db.photos, db.outbox];

export async function deleteSurvey(id: string) {
  await db.transaction('rw', allTables(), async () => {
    for (const t of ['photos', 'devices', 'racks', 'rooms', 'floors'] as const)
      await removeAll(t, await db.table(t).where('surveyId').equals(id).toArray());
    const s = await db.surveys.get(id);
    if (s) await removeAll('surveys', [s]);
  });
  notify();
}

export async function deleteRack(id: string) {
  await db.transaction('rw', allTables(), async () => {
    const devices = await db.devices.where('rackId').equals(id).toArray();
    for (const d of devices) await removeAll('photos', await db.photos.where('[ownerKind+ownerId]').equals(['device', d.id]).toArray());
    await removeAll('devices', devices);
    await removeAll('photos', await db.photos.where('[ownerKind+ownerId]').equals(['rack', id]).toArray());
    const r = await db.racks.get(id);
    if (r) await removeAll('racks', [r]);
  });
  notify();
}

export async function deleteDevice(id: string) {
  await db.transaction('rw', allTables(), async () => {
    await removeAll('photos', await db.photos.where('[ownerKind+ownerId]').equals(['device', id]).toArray());
    const d = await db.devices.get(id);
    if (d) await removeAll('devices', [d]);
  });
  notify();
}

export async function deletePhoto(id: string) {
  await db.transaction('rw', [db.photos, db.outbox], async () => {
    const p = await db.photos.get(id);
    if (p) await removeAll('photos', [p]);
  });
  notify();
}

/** Photos taken for a device form that was then cancelled: drop them and anything queued for them. */
export async function discardPhotos(ownerKind: Photo['ownerKind'], ownerId: string) {
  await db.transaction('rw', [db.photos, db.outbox], async () => {
    const ps = await db.photos.where('[ownerKind+ownerId]').equals([ownerKind, ownerId]).toArray();
    for (const p of ps) {
      const e = await db.outbox.get(['photos', p.id]);
      // Never synced: forget it entirely. Otherwise queue a tombstone.
      if (e && e.baseVersion === 0 && !p.version) await db.outbox.delete(['photos', p.id]);
      else await enqueue('photos', p.id, true, p.version);
    }
    await db.photos.bulkDelete(ps.map(p => p.id));
  });
  notify();
}

export type { Transaction };
