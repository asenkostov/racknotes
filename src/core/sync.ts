// Sync protocol shared by the Worker and the app.
//
// Every record has a server version. The app sends its pending changes with the
// version they were based on; the server applies a change only if that version
// is still current, otherwise it reports a conflict. Every applied change gets a
// global, increasing `seq`, so each device pulls only what it has not seen.

export const SYNC_TABLES = ['surveys', 'floors', 'rooms', 'racks', 'devices', 'cables', 'photos'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

/** Fields that never leave the device. */
export const LOCAL_ONLY_FIELDS = ['blob', 'uploaded', 'version'] as const;

export const MAX_CHANGES_PER_REQUEST = 200;
export const MAX_RECORD_BYTES = 64 * 1024;
export const PULL_PAGE = 500;
export const MAX_PHOTO_BYTES = 1_500_000;

export interface Change {
  table: SyncTable;
  id: string;
  /** Server version the local edit started from; 0 for a record the server has never seen. */
  baseVersion: number;
  deleted: boolean;
  data: Record<string, unknown> | null;
}

export interface ServerRecord {
  table: SyncTable;
  id: string;
  version: number;
  deleted: boolean;
  seq: number;
  updatedAt: string;
  updatedBy: string;
  data: Record<string, unknown> | null;
}

export interface SyncRequest {
  cursor: number;
  changes: Change[];
}

export interface SyncResponse {
  applied: { table: SyncTable; id: string; version: number }[];
  conflicts: ServerRecord[];
  rejected: { table: SyncTable; id: string; reason: string }[];
  changes: ServerRecord[];
  cursor: number;
  more: boolean;
}

export const isSyncTable = (t: unknown): t is SyncTable =>
  typeof t === 'string' && (SYNC_TABLES as readonly string[]).includes(t);

export function stripLocal(record: Record<string, unknown>): Record<string, unknown> {
  const out = { ...record };
  for (const f of LOCAL_ONLY_FIELDS) delete out[f];
  return out;
}

/** Validate one incoming change; returns an error message or null. */
export function validateChange(c: unknown): string | null {
  if (!c || typeof c !== 'object') return 'Невалидна промяна.';
  const ch = c as Partial<Change>;
  if (!isSyncTable(ch.table)) return 'Непозната таблица.';
  if (typeof ch.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(ch.id)) return 'Невалиден идентификатор.';
  if (!Number.isInteger(ch.baseVersion) || (ch.baseVersion as number) < 0) return 'Невалидна версия.';
  if (typeof ch.deleted !== 'boolean') return 'Невалиден флаг за изтриване.';
  if (!ch.deleted) {
    if (!ch.data || typeof ch.data !== 'object' || Array.isArray(ch.data)) return 'Липсват данни.';
    if (ch.data.id !== ch.id) return 'Идентификаторът в данните не съвпада.';
    if (ch.table !== 'surveys' && typeof ch.data.surveyId !== 'string') return 'Липсва огледът, към който принадлежи записът.';
    if (ch.table === 'photos' && (typeof ch.data.hash !== 'string' || !/^[0-9a-f]{64}$/.test(ch.data.hash)))
      return 'Снимката няма валиден отпечатък.';
    if (JSON.stringify(ch.data).length > MAX_RECORD_BYTES) return 'Записът е твърде голям.';
  }
  return null;
}
