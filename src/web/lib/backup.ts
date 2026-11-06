import { db } from './db.ts';
import { requestSync } from './sync.svelte.ts';

// Full local backup as one JSON file (photos inlined as data URLs).
// Until sync exists (milestone 2) this is the way to move data between devices.

const tables = ['surveys', 'floors', 'rooms', 'racks', 'devices', 'cables', 'photos'] as const;
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
    out[t] = t === 'photos' ? await Promise.all(rows.map(async p => ({ ...p, blob: p.blob ? await toDataUrl(p.blob) : null }))) : rows;
  }
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

/** Merge a backup into the local store; records with the same id are replaced. */
export async function importBackup(file: File): Promise<number> {
  const data = JSON.parse(await file.text());
  if (data?.format !== FORMAT || data.version !== 1) throw new Error('Файлът не е архив на RackNotes.');
  let count = 0;
  let n = Date.now();
  await db.transaction('rw', [...tables.map(t => db.table(t)), db.outbox], async () => {
    for (const t of tables) {
      const rows = Array.isArray(data[t]) ? data[t] : [];
      for (const row of rows) {
        if (typeof row?.id !== 'string') throw new Error('Повреден архив.');
        if (t === 'photos') {
          if (row.blob) row.blob = await (await fetch(row.blob)).blob();
          else delete row.blob;
          row.uploaded = false;
        }
        await db.table(t).put(row);
        // Queue for sync; the server decides whether it is new or already known.
        await db.outbox.put({ table: t, id: row.id, deleted: false, baseVersion: row.version ?? 0, queuedAt: n++ });
        count++;
      }
    }
  });
  notifyImported();
  return count;
}
const notifyImported = () => requestSync(100);
