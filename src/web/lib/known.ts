// What exists in the organisation's NetBox, remembered from NetBox files imported on this
// device, so the export can leave those objects out (NetBox refuses duplicates).
import { emptyKnown, type Known } from '../../core/export.ts';
import { knownFromFiles, type NetboxFile } from '../../core/netbox.ts';
import { db } from './db.ts';

const KEY = 'netboxKnown';

export async function getKnown(): Promise<Known> {
  const row = await db.kv.get(KEY);
  return { ...emptyKnown(), ...((row?.value as Known | undefined) ?? {}) };
}

export async function addKnown(files: NetboxFile[]): Promise<Known> {
  const k = knownFromFiles(files, await getKnown());
  await db.kv.put({ key: KEY, value: k });
  return k;
}

export async function clearKnown() {
  await db.kv.delete(KEY);
}
