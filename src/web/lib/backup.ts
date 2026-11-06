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

/** One survey with everything under it, in the same format as the full backup (restorable the same way). */
export async function exportSurvey(surveyId: string): Promise<{ blob: Blob; name: string }> {
  const survey = await db.surveys.get(surveyId);
  if (!survey) throw new Error('Огледът не е намерен.');
  const out: Record<string, unknown> = { format: FORMAT, version: 1, scope: 'survey', exportedAt: new Date().toISOString() };
  for (const t of tables) {
    const rows = t === 'surveys' ? [survey] : await db.table(t).where('surveyId').equals(surveyId).toArray();
    out[t] = t === 'photos' ? await Promise.all(rows.map(async p => ({ ...p, blob: p.blob ? await toDataUrl(p.blob) : null }))) : rows;
  }
  const slug = `${survey.tenant}-${survey.site}`.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60);
  return { blob: new Blob([JSON.stringify(out)], { type: 'application/json' }), name: `racknotes-${slug}-${new Date().toISOString().slice(0, 10)}.json` };
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Read a RackNotes file without importing it: what it contains. */
export async function inspectBackup(file: File) {
  const data = JSON.parse(await file.text());
  if (data?.format !== FORMAT) return null;
  const surveys = (data.surveys ?? []) as { tenant: string; site: string }[];
  return {
    scope: data.scope === 'survey' ? 'survey' : 'all',
    exportedAt: String(data.exportedAt ?? ''),
    surveys: surveys.map(s => `${s.tenant} · ${s.site}`),
    counts: Object.fromEntries(tables.map(t => [t, Array.isArray(data[t]) ? data[t].length : 0]))
  };
}

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
  // Decode photos first: awaiting anything but IndexedDB inside a Dexie
  // transaction makes it commit early.
  for (const t of tables) if (!Array.isArray(data[t])) data[t] = [];
  for (const row of data.photos) {
    if (row.blob) row.blob = await (await fetch(row.blob)).blob();
    else delete row.blob;
    row.uploaded = false;
  }
  let count = 0;
  let n = Date.now();
  await db.transaction('rw', [...tables.map(t => db.table(t)), db.outbox], async () => {
    for (const t of tables) {
      for (const row of data[t]) {
        if (typeof row?.id !== 'string') throw new Error('Повреден архив.');
        await db.table(t).put(row);
        // Queue for sync; the server decides whether it is new, known, or deleted and now restored.
        await db.outbox.put({ table: t, id: row.id, deleted: false, baseVersion: row.version ?? 0, queuedAt: n++ });
        count++;
      }
    }
  });
  notifyImported();
  return count;
}
const notifyImported = () => requestSync(100);
