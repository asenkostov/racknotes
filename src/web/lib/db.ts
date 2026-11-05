import Dexie, { type EntityTable } from 'dexie';
import type { Device, Floor, Photo, Rack, Room, Survey } from '../../core/model.ts';
import { now } from '../../core/model.ts';

/** Local, offline store. Everything the field person enters lives here first. */
export class RackDb extends Dexie {
  surveys!: EntityTable<Survey, 'id'>;
  floors!: EntityTable<Floor, 'id'>;
  rooms!: EntityTable<Room, 'id'>;
  racks!: EntityTable<Rack, 'id'>;
  devices!: EntityTable<Device, 'id'>;
  photos!: EntityTable<Photo, 'id'>;

  constructor(name = 'racknotes') {
    super(name);
    this.version(1).stores({
      surveys: 'id, updatedAt, status',
      floors: 'id, surveyId',
      rooms: 'id, surveyId, floorId',
      racks: 'id, surveyId, roomId',
      devices: 'id, surveyId, rackId, status',
      photos: 'id, surveyId, [ownerKind+ownerId]'
    });
  }
}

export const db = new RackDb();

type Table = 'surveys' | 'floors' | 'rooms' | 'racks' | 'devices' | 'photos';

/** Save a record and bump updatedAt (and the parent survey's) in one transaction. */
export async function save<T extends { id: string; updatedAt: string; surveyId?: string }>(
  table: Table,
  record: T
): Promise<T> {
  const t = now();
  const next = { ...record, updatedAt: t };
  await db.transaction('rw', db.table(table), db.surveys, async () => {
    await db.table(table).put(next);
    const sid = table === 'surveys' ? undefined : next.surveyId;
    if (sid) await db.surveys.update(sid, { updatedAt: t });
  });
  return next;
}

/** Delete a survey and everything under it. */
export async function deleteSurvey(id: string) {
  await db.transaction('rw', [db.surveys, db.floors, db.rooms, db.racks, db.devices, db.photos], async () => {
    for (const t of [db.floors, db.rooms, db.racks, db.devices, db.photos] as const)
      await t.where('surveyId').equals(id).delete();
    await db.surveys.delete(id);
  });
}

export async function deleteRack(id: string) {
  await db.transaction('rw', [db.racks, db.devices, db.photos], async () => {
    const devs = await db.devices.where('rackId').equals(id).primaryKeys();
    for (const d of devs) await db.photos.where('[ownerKind+ownerId]').equals(['device', d]).delete();
    await db.devices.where('rackId').equals(id).delete();
    await db.photos.where('[ownerKind+ownerId]').equals(['rack', id]).delete();
    await db.racks.delete(id);
  });
}

export async function deleteDevice(id: string) {
  await db.transaction('rw', [db.devices, db.photos], async () => {
    await db.photos.where('[ownerKind+ownerId]').equals(['device', id]).delete();
    await db.devices.delete(id);
  });
}
