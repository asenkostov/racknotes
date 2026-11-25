import { describe, expect, it } from 'vitest';
import { buildExport, csv, emptyKnown, readme, slugify } from '../src/core/export.ts';
import type { Device, Floor, Rack, Room, Survey } from '../src/core/model.ts';
import { baseline } from '../src/core/verify.ts';

const t = '2026-11-24T00:00:00Z';
const survey = (extra: Partial<Survey> = {}): Survey => ({ id: 's', createdAt: t, updatedAt: t, tenant: 'Клиент ООД', site: 'Офис София', building: 'бл. 2', status: 'in_progress', author: '', notes: '', ...extra });
const floor = (id: string, name: string, extra: Partial<Floor> = {}): Floor => ({ id, createdAt: t, updatedAt: t, surveyId: 's', level: 0, name, ...extra });
const room = (id: string, floorId: string, name: string, extra: Partial<Room> = {}): Room => ({ id, createdAt: t, updatedAt: t, surveyId: 's', floorId, name, ...extra });
const rack = (id: string, roomId: string, name: string, extra: Partial<Rack> = {}): Rack => ({ id, createdAt: t, updatedAt: t, surveyId: 's', roomId, name, uHeight: 42, notes: '', ...extra });
const dev = (id: string, extra: Partial<Device> = {}): Device => ({
  id, createdAt: t, updatedAt: t, surveyId: 's', rackId: 'r1', name: id, manufacturer: 'Cisco', model: 'C9300-48P', role: 'Switch', uHeight: 1,
  position: 10, face: 'front', fullDepth: true, serial: 'SN' + id, assetTag: '', mgmtIp: '', status: 'confirmed', notes: '', ...extra
});
const file = (r: ReturnType<typeof buildExport>, name: string) => r.files.find(f => f.name.includes(name));

describe('slugs and CSV', () => {
  it('transliterates Bulgarian and keeps NetBox slug rules', () => {
    expect(slugify('Сървърно помещение 1.04')).toBe('sarvarno-pomeshtenie-1-04');
    expect(slugify('Офис „Юг“ / ЩИТ')).toBe('ofis-yug-shtit');
    expect(slugify('***')).toBe('x');
  });
  it('quotes commas, quotes and new lines, without a BOM', () => {
    expect(csv({ header: ['a', 'b'], rows: [{ a: 'x,y', b: 'say "hi"\nok' }] })).toBe('a,b\n"x,y","say ""hi""\nok"\n');
  });
});

describe('export of a new survey', () => {
  const r = buildExport(
    {
      survey: survey(),
      floors: [floor('f1', 'Етаж 1')],
      rooms: [room('rm1', 'f1', 'Сървърно 1.04')],
      racks: [rack('r1', 'rm1', 'R01')],
      devices: [
        dev('SW-01', { mgmtIp: '10.0.0.2' }),
        dev('TRAY', { model: 'Тава 2U', manufacturer: 'Generic', role: 'Shelf', uHeight: 2, position: 12 }),
        dev('NAS-1', { manufacturer: 'Synology', model: 'DS923+', role: 'Storage', parentId: 'TRAY', position: 0 }),
        dev('X', { name: '', manufacturer: '', model: '', role: '', position: 1 })
      ]
    },
    emptyKnown()
  );
  it('creates everything in dependency order', () => {
    expect(r.files.map(f => f.name)).toEqual(['01-tenants.csv', '02-sites.csv', '03-locations.csv', '04-manufacturers.csv', '05-device-roles.csv', '06-device-types.csv', '07-racks.csv', '09-devices.csv']);
    expect(file(r, 'locations')!.rows).toEqual([
      { site: 'Офис София', parent: '', name: 'Етаж 1', slug: 'etazh-1', status: 'active', tenant: 'Клиент ООД' },
      { site: 'Офис София', parent: 'Етаж 1', name: 'Сървърно 1.04', slug: 'sarvarno-1-04', status: 'active', tenant: 'Клиент ООД' }
    ]);
    expect(file(r, 'racks')!.rows[0]).toMatchObject({ site: 'Офис София', location: 'Сървърно 1.04', name: 'R01', width: 19, u_height: 42 });
  });
  it('puts devices on a tray in the rack without a U, and notes where they sit', () => {
    const nas = file(r, '09-devices')!.rows.find(x => x.name === 'NAS-1')!;
    expect(nas).toMatchObject({ rack: 'R01', position: '', face: '', comments: 'Стои на/в: TRAY' });
    expect(file(r, '09-devices')!.rows.find(x => x.name === 'TRAY')).toMatchObject({ position: 12, face: 'front', device_type: 'Тава 2U' });
  });
  it('fills in Unknown for missing model and role, and warns', () => {
    expect(file(r, '06-device-types')!.rows.map(x => x.model)).toContain('Unknown');
    expect(file(r, '05-device-roles')!.rows.map(x => x.name)).toContain('Unknown');
    expect(r.warnings.join(' ')).toMatch(/без модел/);
    expect(r.warnings.join(' ')).toMatch(/IP адреса/);
    expect(file(r, '09-devices')!.rows.find(x => x.name === 'SW-01')!.comments).toBe('IP за управление: 10.0.0.2');
  });
  it('leaves out what NetBox already has', () => {
    const k = { ...emptyKnown(), tenants: ['клиент ООД'], sites: ['Офис София'], manufacturers: ['Cisco', 'Generic', 'Synology', 'Unknown'], roles: ['Switch', 'Shelf', 'Storage', 'Unknown'], deviceTypes: ['Cisco\u0000C9300-48P'] };
    const r2 = buildExport({ survey: survey(), floors: [floor('f1', 'Етаж 1')], rooms: [room('rm1', 'f1', 'Сървърно 1.04')], racks: [rack('r1', 'rm1', 'R01')], devices: [dev('SW-01')] }, k);
    expect(r2.files.map(f => f.name)).toEqual(['03-locations.csv', '07-racks.csv', '09-devices.csv']);
  });
});

describe('export of a verified NetBox site', () => {
  const nbDev = (id: string, extra: Partial<Device> = {}) => {
    const d = dev(id, { netboxId: Number(id.replace(/\D/g, '')) || 1, ...extra });
    return { ...d, nb: baseline(d) };
  };
  const input = {
    survey: survey({ netboxId: 5, verify: { startedAt: t } }),
    floors: [floor('nb-site-5-floor', 'От NetBox'), floor('f2', 'Етаж 2')],
    rooms: [room('nb-location-7', 'nb-site-5-floor', 'DC-A', { netboxId: 7 }), room('nb-site-5-room-none', 'nb-site-5-floor', 'X · без помещение'), room('rm9', 'f2', 'Ново помещение')],
    racks: [
      rack('r1', 'nb-location-7', 'R1', { netboxId: 1, nb: { name: 'R1', roomId: 'nb-location-7', uHeight: 42 } }),
      rack('r2', 'nb-site-5-room-none', 'R2', { netboxId: 2, nb: { name: 'R2', roomId: 'nb-site-5-room-none', uHeight: 42 } }),
      rack('r3', 'rm9', 'R3')
    ],
    devices: [] as Device[]
  };
  const same = nbDev('d1', { verify: 'ok' });
  const changed = { ...nbDev('d2'), serial: 'FIELD', position: 20 };
  const moved = { ...nbDev('d3'), rackId: 'r2' };
  const blade = { ...nbDev('d4', { parentId: 'd2', position: 0 }), serial: 'BLADE-NEW' };
  const gone = nbDev('d5', { verify: 'missing' });
  const added = dev('NEW-1', { rackId: 'r3', position: 5 });
  input.devices = [same, changed, moved, blade, gone, added];
  input.racks[0] = { ...input.racks[0], name: 'R1-renamed' };
  const r = buildExport(input, emptyKnown());

  it('does not create the site, the made-up floor or the no-location room', () => {
    expect(file(r, 'sites')).toBeUndefined();
    expect(file(r, 'locations')!.rows.map(x => [x.parent, x.name])).toEqual([['', 'Етаж 2'], ['Етаж 2', 'Ново помещение']]);
    expect(file(r, '07-racks')!.rows).toEqual([expect.objectContaining({ name: 'R3', location: 'Ново помещение' })]);
  });
  it('updates changed racks and devices by id, with their location', () => {
    expect(file(r, 'racks-update')!.rows).toEqual([{ id: 1, site: 'Офис София', location: 'DC-A', name: 'R1-renamed', u_height: 42 }]);
    const upd = file(r, '10-devices-update')!.rows;
    expect(upd.map(x => x.id)).toEqual([2, 3]);
    expect(upd[0]).toMatchObject({ serial: 'FIELD', position: 20, rack: 'R1-renamed', location: 'DC-A' });
    expect(upd[1]).toMatchObject({ rack: 'R2', location: '' });
  });
  it('keeps chassis children in their bay and only updates their fields', () => {
    expect(file(r, 'in-chassis')!.rows).toEqual([expect.objectContaining({ id: 4, serial: 'BLADE-NEW' })]);
    expect(file(r, 'in-chassis')!.header).not.toContain('rack');
  });
  it('lists missing devices and offers an optional offline file', () => {
    expect(r.missing.map(d => d.id)).toEqual(['d5']);
    expect(file(r, 'offline')).toMatchObject({ optional: true, rows: [{ id: 5, status: 'offline' }] });
    expect(file(r, '09-devices')!.rows.map(x => x.name)).toEqual(['NEW-1']);
    expect(readme(r, input.survey, t)).toContain('12-devices-missing-offline.csv  (1)');
  });
});
