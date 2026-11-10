import { describe, expect, it } from 'vitest';
import { buildImport, classify } from '../src/core/netbox.ts';

// Synthetic NetBox 4.1 responses — shape only, no real client data.
const H = 'https://netbox.example';
const list = (path: string, results: object[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results: results.map((r: any) => ({ url: `${H}/api/${path}/${r.id}/`, ...r }))
});
const site = { id: 9, name: 'ACME-HQ' };
const tenant = { id: 3, name: 'ACME' };

const racks = list('dcim/racks', [{ id: 1, name: 'R1', site, tenant, location: null, u_height: 10, created: '2026-01-01T00:00:00Z', description: 'main', comments: '' }]);
const types = list('dcim/device-types', [
  { id: 10, model: 'SW-48', u_height: 1, is_full_depth: true },
  { id: 11, model: 'Chassis-7', u_height: 7, is_full_depth: true },
  { id: 12, model: 'Blade', u_height: 0, is_full_depth: false },
  { id: 13, model: 'Strip', u_height: 1, is_full_depth: false },
  { id: 14, model: 'Vertical PDU', u_height: 0, is_full_depth: false }
]);
const dev = (id: number, name: string, type: number, position: number | null, face: string | null, extra: object = {}) => ({
  id, name, device_type: { id: type, model: `m${type}`, manufacturer: { name: 'Vendor' } }, role: { name: 'Role' },
  rack: { id: 1 }, position, face: face ? { value: face } : null, serial: '', asset_tag: null, primary_ip4: null, parent_device: null, ...extra
});
const devices = list('dcim/devices', [
  dev(100, 'sw1', 10, 9, 'front', { primary_ip4: { address: '10.0.0.5/24' } }),
  dev(101, 'chassis', 11, 1, 'front'),
  dev(102, 'blade-1', 12, null, null, { parent_device: { id: 101 } }),
  dev(103, 'strip-rear', 13, 9, 'rear'),
  dev(104, 'pdu-v', 14, null, null),
  { ...dev(105, 'elsewhere', 10, 1, 'front'), rack: { id: 99 } }
]);
const term = (type: string, o: object) => [{ object_type: type, object: o }];
const cables = list('dcim/cables', [
  { id: 500, label: 'UPLINK', type: '', a_terminations: term('dcim.interface', { name: 'e1', device: { id: 100 } }), b_terminations: term('dcim.interface', { name: 'g1/0/1', device: { id: 777, name: 'core-sw' } }) },
  { id: 501, label: '', display: '#501', type: 'power', a_terminations: term('dcim.powerfeed', { id: 1, name: 'feed-a' }), b_terminations: term('dcim.powerport', { name: 'Input', device: { id: 104 } }) },
  { id: 502, label: 'X', type: '', a_terminations: term('dcim.interface', { name: 'a', device: { id: 800 } }), b_terminations: term('dcim.interface', { name: 'b', device: { id: 801 } }) }
]);
const feeds = list('dcim/power-feeds', [{ id: 1, name: 'feed-a', power_panel: { name: 'Panel 1' } }]);

const files = [racks, types, devices, cables, feeds].map(classify);
const plan = buildImport(files, { author: 'tester', now: '2026-11-06T00:00:00.000Z' });

describe('classify', () => {
  it('recognises endpoints and completeness', () => {
    expect(files.map(f => f.kind)).toEqual(['racks', 'device-types', 'devices', 'cables', 'power-feeds']);
    expect(files[0].host).toBe(H);
    expect(classify({ count: 5, next: `${H}/api/dcim/racks/?offset=1`, results: racks.results }).complete).toBe(false);
    expect(() => classify({ foo: 1 })).toThrow(/results/);
  });
});

describe('buildImport', () => {
  it('maps tenant, site, rack and a default room', () => {
    expect(plan.survey).toMatchObject({ id: 'nb-site-9', tenant: 'ACME', site: 'ACME-HQ', status: 'imported', netboxId: 9 });
    expect(plan.rooms).toHaveLength(1);
    expect(plan.racks[0]).toMatchObject({ id: 'nb-rack-1', uHeight: 10, roomId: plan.rooms[0].id });
  });

  it('places devices with height, face and depth from the device type', () => {
    const by = Object.fromEntries(plan.devices.map(d => [d.name, d]));
    expect(by.sw1).toMatchObject({ position: 9, uHeight: 1, face: 'front', fullDepth: true, mgmtIp: '10.0.0.5', status: 'confirmed' });
    expect(by.chassis).toMatchObject({ position: 1, uHeight: 7 });
    expect(by['strip-rear']).toMatchObject({ position: 9, face: 'rear', fullDepth: false });
    expect(by['pdu-v'].position).toBe(0);
    expect(by['blade-1']).toMatchObject({ parentId: 'nb-device-101', position: 0 });
    expect(by.elsewhere).toBeUndefined();
    expect(plan.skipped.devices).toBe(1);
  });

  it('flags a full-depth device sharing a U with a rear device', () => {
    expect(plan.warnings.some(w => w.includes('застъпва'))).toBe(true);
  });

  it('links cables to devices and keeps outside ends by name', () => {
    const up = plan.cables.find(c => c.label === 'UPLINK')!;
    expect(up).toMatchObject({ type: 'data', a: { deviceId: 'nb-device-100', port: 'e1' }, b: { external: 'core-sw', port: 'g1/0/1' } });
    const pw = plan.cables.find(c => c.netboxId === 501)!;
    expect(pw).toMatchObject({ type: 'power', a: { external: 'feed-a (Panel 1)', kind: 'powerfeed' }, b: { deviceId: 'nb-device-104' } });
    expect(plan.cables.find(c => c.netboxId === 502)).toBeUndefined();
    expect(plan.skipped.cables).toBe(1);
  });

  it('is deterministic across imports', () => {
    const again = buildImport(files, { author: 'other', now: '2026-12-01T00:00:00.000Z' });
    expect(again.devices.map(d => [d.id, d.createdAt])).toEqual(plan.devices.map(d => [d.id, d.createdAt]));
  });
});

describe('refresh from NetBox', () => {
  it('keeps field work and takes NetBox changes where nothing was changed locally', async () => {
    const { mergeImport } = await import('../src/core/netbox.ts');
    const { baseline } = await import('../src/core/verify.ts');
    const base = {
      id: 'nb-device-1', surveyId: 'nb-site-1', rackId: 'nb-rack-1', name: 'sw1', manufacturer: 'Cisco', model: 'C9300',
      role: 'switch', uHeight: 1, position: 10, face: 'front' as const, fullDepth: true, serial: 'A', assetTag: '', mgmtIp: '10.0.0.1',
      status: 'confirmed' as const, notes: '', createdAt: 't0', updatedAt: 't0', netboxId: 1
    };
    const local = { ...base, nb: baseline(base), serial: 'FIELD', verify: 'ok' as const, version: 3 };
    const incoming = { ...base, mgmtIp: '10.0.0.2', serial: 'B', createdAt: 't1', updatedAt: 't1' };
    const room = { id: 'r', surveyId: 'nb-site-1', floorId: 'f', name: 'Old', createdAt: '', updatedAt: '', widthM: 6, depthM: 4, items: [] };
    const rack = { id: 'nb-rack-1', surveyId: 'nb-site-1', roomId: 'r', name: 'R1', uHeight: 42, notes: 'n', createdAt: '', updatedAt: '', plan: { x: 1, y: 1, facing: 'down' as const } };
    const survey = { id: 'nb-site-1', tenant: 'T', site: 'S', building: 'B', status: 'review' as const, author: 'a', notes: 'keep', createdAt: '', updatedAt: '', verify: { startedAt: 'x' } };
    const plan = {
      survey: { ...survey, notes: '', status: 'imported' as const, verify: undefined, site: 'S2' },
      floors: [], rooms: [{ ...room, name: 'New', widthM: undefined, depthM: undefined, items: undefined }],
      racks: [{ ...rack, uHeight: 48, plan: undefined, notes: '' }], devices: [incoming], cables: [], warnings: [], skipped: { cables: 0, devices: 0 }
    };
    const m = mergeImport(plan as never, {
      surveys: new Map([[survey.id, survey]]), floors: new Map(), rooms: new Map([[room.id, room]]),
      racks: new Map([[rack.id, rack]]), devices: new Map([[local.id, local]])
    } as never);
    expect(m.survey).toMatchObject({ site: 'S2', notes: 'keep', status: 'review', verify: { startedAt: 'x' } });
    expect(m.rooms[0]).toMatchObject({ name: 'New', widthM: 6, depthM: 4 });
    expect(m.racks[0]).toMatchObject({ uHeight: 48, notes: 'n', plan: { x: 1 } });
    const d = m.devices[0];
    expect(d).toMatchObject({ serial: 'FIELD', mgmtIp: '10.0.0.2', verify: 'ok', createdAt: 't0' });
    expect(d.nb).toMatchObject({ serial: 'B', mgmtIp: '10.0.0.2' });
  });
});
