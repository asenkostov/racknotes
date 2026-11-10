// Verifying a site that came from NetBox: each imported device is checked on
// site (matches / differs / missing) and new devices are added. The baseline is
// what NetBox said at import time (device.nb); differences are computed, never
// typed in twice.

import type { Device, DeviceBaseline } from './model.ts';

export type VerifyState = 'pending' | 'ok' | 'changed' | 'missing' | 'new';

export const FIELD_LABELS: Record<keyof DeviceBaseline, string> = {
  name: 'Име',
  manufacturer: 'Производител',
  model: 'Модел',
  serial: 'Сериен №',
  assetTag: 'Инв. №',
  rackId: 'Шкаф',
  position: 'U позиция',
  face: 'Страна',
  mgmtIp: 'IP за управление',
  role: 'Роля',
  parentId: 'В шаси'
};

export function baseline(d: Device): DeviceBaseline {
  return {
    name: d.name,
    manufacturer: d.manufacturer,
    model: d.model,
    serial: d.serial,
    assetTag: d.assetTag,
    rackId: d.rackId,
    position: d.position,
    face: d.face,
    mgmtIp: d.mgmtIp,
    role: d.role,
    ...(d.parentId ? { parentId: d.parentId } : {})
  };
}

export interface FieldDiff {
  field: keyof DeviceBaseline;
  label: string;
  was: string | number;
  now: string | number;
}

const same = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** Fields that differ from NetBox. Empty for new devices and for unchanged ones. */
export function diff(d: Device): FieldDiff[] {
  if (!d.nb) return [];
  const now = baseline(d);
  const out: FieldDiff[] = [];
  for (const f of Object.keys(FIELD_LABELS) as (keyof DeviceBaseline)[]) {
    // Position and face only matter for racked devices.
    if ((f === 'face' || f === 'position') && !d.nb.position && !now.position) continue;
    if (!same(d.nb[f], now[f])) out.push({ field: f, label: FIELD_LABELS[f], was: d.nb[f] ?? '', now: now[f] ?? '' });
  }
  return out;
}

export function verifyState(d: Device): VerifyState {
  if (!d.netboxId) return 'new';
  if (d.verify === 'missing') return 'missing';
  if (diff(d).length) return 'changed';
  return d.verify === 'ok' ? 'ok' : 'pending';
}

export const STATE_LABELS: Record<VerifyState, string> = {
  pending: 'за проверка',
  ok: 'съвпада',
  changed: 'различно',
  missing: 'липсва',
  new: 'ново'
};

export const STATE_SYMBOLS: Record<VerifyState, string> = { pending: '○', ok: '✓', changed: '✎', missing: '✗', new: '+' };

export function summary(devices: Device[]): Record<VerifyState, number> & { total: number; done: number } {
  const s = { pending: 0, ok: 0, changed: 0, missing: 0, new: 0, total: 0, done: 0 };
  for (const d of devices) s[verifyState(d)]++;
  s.total = s.pending + s.ok + s.changed + s.missing;
  s.done = s.total - s.pending;
  return s;
}

/**
 * Order to walk a rack in: top to bottom on the front, then the rear, then
 * unracked devices, then children of chassis (right after their chassis).
 */
export function walkOrder(devices: Device[]): Device[] {
  const top = devices.filter(d => !d.parentId);
  const racked = top.filter(d => d.position > 0).sort((a, b) => (a.face === b.face ? b.position - a.position : a.face === 'front' ? -1 : 1));
  const loose = top.filter(d => d.position <= 0).sort((a, b) => (a.name || a.model).localeCompare(b.name || b.model));
  const out: Device[] = [];
  for (const d of [...racked, ...loose]) {
    out.push(d);
    out.push(...devices.filter(c => c.parentId === d.id).sort((a, b) => a.name.localeCompare(b.name)));
  }
  // Children whose chassis is not in this list.
  for (const d of devices) if (!out.includes(d)) out.push(d);
  return out;
}

/** Next device still to check after `afterId` (wraps around), or undefined when all are done. */
export function nextPending(devices: Device[], afterId?: string): Device | undefined {
  const order = walkOrder(devices).filter(d => d.netboxId);
  const i = afterId ? order.findIndex(d => d.id === afterId) : -1;
  const rotated = [...order.slice(i + 1), ...order.slice(0, i + 1)];
  return rotated.find(d => verifyState(d) === 'pending' && d.id !== afterId);
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Differences as CSV (semicolon separated, UTF-8 with BOM, so Excel opens it
 * with Cyrillic intact). One row per changed field, missing device or new device.
 */
export function diffCsv(devices: Device[], rackName: (id: string) => string, deviceName: (id: string) => string): string {
  const head = ['Шкаф', 'U', 'Устройство', 'NetBox ID', 'Състояние', 'Поле', 'В NetBox', 'На място'];
  const rows: unknown[][] = [];
  const show = (f: string, v: string | number) => (f === 'rackId' ? rackName(String(v)) : f === 'parentId' ? (v ? deviceName(String(v)) : '') : v);
  for (const d of walkOrder(devices)) {
    const st = verifyState(d);
    const base = [rackName(d.rackId), d.position || '', d.name || d.model, d.netboxId ?? ''];
    if (st === 'changed') for (const x of diff(d)) rows.push([...base, STATE_LABELS[st], x.label, show(x.field, x.was), show(x.field, x.now)]);
    else if (st === 'missing') rows.push([...base, STATE_LABELS[st], '', '', '']);
    else if (st === 'new') rows.push([...base, STATE_LABELS[st], 'Модел', '', [d.manufacturer, d.model].filter(Boolean).join(' ')], ...(d.serial ? [[...base, STATE_LABELS[st], 'Сериен №', '', d.serial]] : []));
    else if (st === 'pending') rows.push([...base, STATE_LABELS[st], '', '', '']);
  }
  return '﻿' + [head, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
