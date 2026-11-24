import { describe, expect, it } from 'vitest';
import type { Change } from '../src/core/sync.ts';
import { getBlob, putBlob, sha256Hex, sync } from '../src/worker/store.ts';
import { fakeD1 } from './helpers/fake-d1.js';

async function blob(text: string) {
  const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer;
  return { bytes, hash: await sha256Hex(bytes) };
}
const photo = (id: string, hash: string): Change => ({ table: 'photos', id, baseVersion: 0, deleted: false, data: { id, surveyId: 's1', hash, ownerKind: 'device', ownerId: 'd1' } });
const tomb = (id: string, baseVersion: number): Change => ({ table: 'photos', id, baseVersion, deleted: true, data: null });

describe('server store: deleting photos', () => {
  it('deletes the blob when its last photo is deleted', async () => {
    const db = fakeD1();
    const photos = fakeD1();
    const a = await blob('plan of floor 1');
    await sync(db, photos, 'a@x', 0, []); // creates the schema
    await putBlob(photos, a.hash, 'image/jpeg', a.bytes, 'a@x');
    const r1 = await sync(db, photos, 'a@x', 0, [photo('p1', a.hash)]);
    expect(r1.applied).toEqual([{ table: 'photos', id: 'p1', version: 1 }]);
    expect(await getBlob(photos, a.hash)).not.toBeNull();

    const r2 = await sync(db, photos, 'a@x', r1.cursor, [tomb('p1', 1)]);
    expect(r2.applied).toHaveLength(1);
    expect(await getBlob(photos, a.hash)).toBeNull();
  });

  it('keeps a blob that another live photo still uses', async () => {
    const db = fakeD1();
    const photos = fakeD1();
    const a = await blob('same picture');
    await sync(db, photos, 'a@x', 0, []);
    await putBlob(photos, a.hash, 'image/jpeg', a.bytes, 'a@x');
    await sync(db, photos, 'a@x', 0, [photo('p1', a.hash), photo('p2', a.hash)]);
    await sync(db, photos, 'a@x', 0, [tomb('p1', 1)]);
    expect(await getBlob(photos, a.hash)).not.toBeNull();
    await sync(db, photos, 'a@x', 0, [tomb('p2', 1)]);
    expect(await getBlob(photos, a.hash)).toBeNull();
  });

  it('keeps the blob when the delete loses to a newer edit', async () => {
    const db = fakeD1();
    const photos = fakeD1();
    const a = await blob('edited elsewhere');
    await sync(db, photos, 'a@x', 0, []);
    await putBlob(photos, a.hash, 'image/jpeg', a.bytes, 'a@x');
    await sync(db, photos, 'a@x', 0, [photo('p1', a.hash)]);
    await sync(db, photos, 'b@x', 0, [{ ...photo('p1', a.hash), baseVersion: 1 }]); // version 2
    const r = await sync(db, photos, 'a@x', 0, [tomb('p1', 1)]); // stale
    expect(r.conflicts).toHaveLength(1);
    expect(await getBlob(photos, a.hash)).not.toBeNull();
  });
});

describe('server store: deleted records', () => {
  const rack = (baseVersion: number, extra: Partial<Change> = {}): Change => ({ table: 'racks', id: 'r1', baseVersion, deleted: false, data: { id: 'r1', surveyId: 's1', name: 'R1' }, ...extra });
  it('an edit from a device that missed the delete is a conflict, not a silent comeback', async () => {
    const db = fakeD1();
    const photos = fakeD1();
    await sync(db, photos, 'a@x', 0, [rack(0)]);
    await sync(db, photos, 'a@x', 0, [{ table: 'racks', id: 'r1', baseVersion: 1, deleted: true, data: null }]);
    const stale = await sync(db, photos, 'b@x', 0, [rack(1)]);
    expect(stale.applied).toHaveLength(0);
    expect(stale.conflicts.map(c => [c.id, c.deleted])).toEqual([['r1', true]]);
  });
  it('a restore from file may bring a deleted record back', async () => {
    const db = fakeD1();
    const photos = fakeD1();
    await sync(db, photos, 'a@x', 0, [rack(0)]);
    await sync(db, photos, 'a@x', 0, [{ table: 'racks', id: 'r1', baseVersion: 1, deleted: true, data: null }]);
    const back = await sync(db, photos, 'a@x', 0, [rack(1, { restore: true })]);
    expect(back.applied).toEqual([{ table: 'racks', id: 'r1', version: 3 }]);
  });
});
