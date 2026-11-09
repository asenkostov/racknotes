import { describe, expect, it } from 'vitest';
import type { Device } from '../src/core/model.ts';
import { baseline, diff, diffCsv, nextPending, summary, verifyState, walkOrder } from '../src/core/verify.ts';

const dev = (id: string, extra: Partial<Device> = {}): Device => {
  const d: Device = {
    id, surveyId: 's', rackId: 'r1', name: id, manufacturer: 'Cisco', model: 'C9300', role: 'switch', uHeight: 1,
    position: 10, face: 'front', fullDepth: true, serial: 'SN-' + id, assetTag: '', mgmtIp: '', status: 'confirmed', notes: '',
    createdAt: '', updatedAt: '', netboxId: 1, ...extra
  };
  return { nb: baseline(d), ...d, ...extra };
};

describe('verification', () => {
  it('derives the state from the baseline and the mark', () => {
    expect(verifyState(dev('a'))).toBe('pending');
    expect(verifyState(dev('a', { verify: 'ok' }))).toBe('ok');
    expect(verifyState({ ...dev('a'), serial: 'OTHER' })).toBe('changed');
    expect(verifyState({ ...dev('a', { verify: 'ok' }), position: 12 })).toBe('changed');
    expect(verifyState(dev('a', { verify: 'missing' }))).toBe('missing');
    expect(verifyState({ ...dev('a'), netboxId: undefined, nb: undefined })).toBe('new');
  });

  it('lists differences, ignoring case and spaces', () => {
    const d = { ...dev('a'), serial: ' sn-a ', position: 12, mgmtIp: '10.0.0.9' };
    expect(diff(d).map(x => [x.field, x.was, x.now])).toEqual([
      ['position', 10, 12],
      ['mgmtIp', '', '10.0.0.9']
    ]);
  });

  it('walks top-down, front before rear, chassis children after their chassis, and finds the next', () => {
    const list = [
      dev('low', { position: 2 }),
      dev('rear', { position: 20, face: 'rear' }),
      dev('high', { position: 30 }),
      dev('blade', { position: 0, parentId: 'high' }),
      dev('pdu', { position: 0 })
    ];
    expect(walkOrder(list).map(d => d.id)).toEqual(['high', 'blade', 'low', 'rear', 'pdu']);
    expect(nextPending(list)?.id).toBe('high');
    expect(nextPending(list.map(d => (d.id === 'blade' ? { ...d, verify: 'ok' as const } : d)), 'high')?.id).toBe('low');
  });

  it('summarises and exports differences as CSV', () => {
    const list = [dev('a', { verify: 'ok' }), { ...dev('b'), serial: 'NEW' }, dev('c', { verify: 'missing' }), { ...dev('d'), netboxId: undefined, nb: undefined }, dev('e')];
    expect(summary(list)).toMatchObject({ ok: 1, changed: 1, missing: 1, new: 1, pending: 1, total: 4, done: 3 });
    const csv = diffCsv(list, () => 'R1', id => id);
    expect(csv.startsWith('﻿Шкаф;U;')).toBe(true);
    expect(csv).toContain('R1;10;b;1;различно;Сериен №;SN-b;NEW');
    expect(csv).toContain('R1;10;c;1;липсва;;;');
    expect(csv).toContain('R1;10;d;;ново;Модел;;Cisco C9300');
    expect(csv).not.toContain(';a;1;съвпада');
  });
});
