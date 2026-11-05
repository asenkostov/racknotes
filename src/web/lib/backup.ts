import { db } from './db.ts';

// Full local backup as one JSON file (photos inlined as data URLs).
// Until sync exists (milestone 2) this is the way to move data between devices.

const tables = ['surveys', 'floors', 'rooms', 'racks', 'devices', 'photos'] as const;
const FORMAT = 'racknotes-backup';

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

export async function exportBackup(): Promise<Blob> {
  const out: Record<string, unknown> = { format: FORMAT, version: 1, exportedAt: new Date().toISOString() };
  for (const t of tables) {
    const rows = await db.table(t).toArray();
    out[t] = t === 'photos' ? await Promise.all(rows.map(async p => ({ ...p, blob: await toDataUrl(p.blob) }))) : rows;
  }
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

/** Merge a backup into the local store; records with the same id are replaced. */
export async function importBackup(file: File): Promise<number> {
  const data = JSON.parse(await file.text());
  if (data?.format !== FORMAT || data.version !== 1) throw new Error('Файлът не е архив на RackNotes.');
  let count = 0;
  await db.transaction('rw', tables.map(t => db.table(t)), async () => {
    for (const t of tables) {
      const rows = Array.isArray(data[t]) ? data[t] : [];
      for (const row of rows) {
        if (typeof row?.id !== 'string') throw new Error('Повреден архив.');
        if (t === 'photos') row.blob = await (await fetch(row.blob)).blob();
        await db.table(t).put(row);
        count++;
      }
    }
  });
  return count;
}
