// Export a survey as CSV files for NetBox 4.1.11 bulk import (Import → CSV),
// in dependency order. Pure functions; covered by tests/export.test.ts.
//
// Field names and lookups follow netbox/dcim/forms/bulk_import.py (v4.1.11):
// related objects are referenced by name (device_type by model), rows with an
// `id` column update existing objects and only touch the columns present.
// NetBox imports a file all-or-nothing, so anything that may already exist in
// NetBox is left out when we know it does (see Known).

import type { Device, Floor, Rack, Room, Survey } from './model.ts';
import { roleColors } from './roles.ts';
import { diff, verifyState } from './verify.ts';

/** What already exists in NetBox, as far as we know (from imported NetBox files). */
export interface Known {
  at?: string;
  tenants: string[];
  sites: string[];
  /** "site\u0000location" */
  locations: string[];
  manufacturers: string[];
  roles: string[];
  /** "manufacturer\u0000model" */
  deviceTypes: string[];
}
export const emptyKnown = (): Known => ({ tenants: [], sites: [], locations: [], manufacturers: [], roles: [], deviceTypes: [] });

export interface ExportInput {
  survey: Survey;
  floors: Floor[];
  rooms: Room[];
  racks: Rack[];
  devices: Device[];
  /** Device type slugs from the catalog, by "manufacturer\u0000model". */
  typeInfo?: Map<string, { slug: string; part?: string }>;
}

export interface CsvFile {
  name: string;
  /** NetBox menu path where this file is imported. */
  where: string;
  title: string;
  optional?: boolean;
  header: string[];
  rows: Record<string, string | number>[];
}

export interface ExportResult {
  files: CsvFile[];
  warnings: string[];
  /** Devices marked missing on site: not changed in NetBox automatically. */
  missing: Device[];
}

const BG: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya'
};

/** NetBox slug: [-a-zA-Z0-9_], Bulgarian transliterated (streamlined system). */
export function slugify(s: string): string {
  const t = s
    .toLowerCase()
    .split('')
    .map(c => BG[c] ?? c)
    .join('')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return t || 'x';
}

export function csv(f: Pick<CsvFile, 'header' | 'rows'>): string {
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // No BOM: NetBox would read it as part of the first column name.
  return [f.header.join(','), ...f.rows.map(r => f.header.map(h => cell(r[h])).join(','))].join('\n') + '\n';
}

const key = (...parts: string[]) => parts.join('\u0000');
const UNKNOWN = 'Unknown';

/** Floors and rooms made up by the NetBox import, not real NetBox locations. */
const synthetic = (x: Floor | Room) => !x.netboxId && (x.id.endsWith('-floor') || x.id.endsWith('-room-none')) && x.id.startsWith('nb-');

export function buildExport(input: ExportInput, known: Known): ExportResult {
  const { survey, floors, rooms, racks } = input;
  const warnings: string[] = [];
  const site = survey.site.trim() || survey.tenant.trim() || 'Обект';
  const tenant = survey.tenant.trim();
  const has = (list: string[], k: string) => list.some(x => x.toLowerCase() === k.toLowerCase());

  // --- tenant, site ---
  const tenants: CsvFile = { name: '01-tenants.csv', where: 'Tenancy → Tenants → Import', title: 'Клиент (tenant)', header: ['name', 'slug'], rows: [] };
  if (tenant && !survey.netboxId && !has(known.tenants, tenant)) tenants.rows.push({ name: tenant, slug: slugify(tenant) });
  const sites: CsvFile = { name: '02-sites.csv', where: 'Organization → Sites → Import', title: 'Обект (site)', header: ['name', 'slug', 'status', 'tenant', 'description'], rows: [] };
  if (!survey.netboxId && !has(known.sites, site))
    sites.rows.push({ name: site, slug: slugify(site), status: 'active', tenant, description: survey.building || '' });

  // --- locations: floor, then room inside it ---
  const floorById = new Map(floors.map(f => [f.id, f]));
  const locations: CsvFile = { name: '03-locations.csv', where: 'Organization → Locations → Import', title: 'Етажи и помещения (locations)', header: ['site', 'parent', 'name', 'slug', 'status', 'tenant'], rows: [] };
  const slugs = new Set<string>();
  const uniqueSlug = (s: string) => {
    let x = slugify(s);
    for (let i = 2; slugs.has(x); i++) x = `${slugify(s)}-${i}`;
    slugs.add(x);
    return x;
  };
  const locKnown = (name: string) => has(known.locations, key(site, name));
  /** Location name for a room in NetBox ('' = rack without location). */
  const roomLoc = new Map<string, string>();
  const floorsUsed = new Set<string>();
  for (const r of rooms) {
    if (synthetic(r)) {
      roomLoc.set(r.id, '');
      continue;
    }
    roomLoc.set(r.id, r.name);
    if (r.netboxId || locKnown(r.name)) continue;
    const f = floorById.get(r.floorId);
    const parent = f && !synthetic(f) ? f.name : '';
    if (f && parent && !f.netboxId && !locKnown(f.name) && !floorsUsed.has(f.id)) {
      floorsUsed.add(f.id);
      locations.rows.push({ site, parent: '', name: f.name, slug: uniqueSlug(f.name), status: 'active', tenant });
    }
    locations.rows.push({ site, parent, name: r.name, slug: uniqueSlug(r.name), status: 'active', tenant });
  }
  const dupRooms = rooms.filter((r, i) => !synthetic(r) && rooms.findIndex(o => o.name.toLowerCase() === r.name.toLowerCase()) !== i);
  if (dupRooms.length) warnings.push(`Помещения с еднакво име (${[...new Set(dupRooms.map(r => r.name))].join(', ')}): NetBox търси помещение по име — преименувай ги.`);

  // --- devices: the type of each, roles, manufacturers ---
  const devices = input.devices.filter(d => verifyState(d) !== 'missing');
  const missing = input.devices.filter(d => verifyState(d) === 'missing');
  const typeOf = (d: Device) => {
    const m = d.manufacturer.trim() || UNKNOWN;
    const model = d.model.trim() || (d.uHeight > 1 ? `${UNKNOWN} ${d.uHeight}U` : UNKNOWN);
    return { m, model };
  };
  const roleOf = (d: Device) => d.role.trim() || UNKNOWN;
  const unnamedModel = devices.filter(d => !d.model.trim()).length;
  if (unnamedModel) warnings.push(`${unnamedModel} устройства без модел влизат като тип „${UNKNOWN}“ — по-добре допиши модела.`);
  const noRole = devices.filter(d => !d.role.trim()).length;
  if (noRole) warnings.push(`${noRole} устройства без роля влизат с роля „${UNKNOWN}“ (в NetBox ролята е задължителна).`);

  const manufacturers: CsvFile = { name: '04-manufacturers.csv', where: 'Devices → Manufacturers → Import', title: 'Производители', header: ['name', 'slug'], rows: [] };
  const roles: CsvFile = { name: '05-device-roles.csv', where: 'Devices → Device Roles → Import', title: 'Роли', header: ['name', 'slug', 'color'], rows: [] };
  const types: CsvFile = {
    name: '06-device-types.csv',
    where: 'Devices → Device Types → Import',
    title: 'Типове устройства',
    header: ['manufacturer', 'model', 'slug', 'part_number', 'u_height', 'is_full_depth'],
    rows: []
  };
  const seenM = new Set<string>();
  const seenR = new Set<string>();
  const seenT = new Map<string, number>();
  const typeSlugs = new Set<string>();
  for (const d of devices) {
    const { m, model } = typeOf(d);
    const role = roleOf(d);
    const fromNb = !!d.nb && d.nb.manufacturer === d.manufacturer && d.nb.model === d.model;
    if (!fromNb && !has(known.manufacturers, m) && !seenM.has(m.toLowerCase())) {
      seenM.add(m.toLowerCase());
      manufacturers.rows.push({ name: m, slug: slugify(m) });
    }
    if (!(d.nb && d.nb.role === d.role) && !has(known.roles, role) && !seenR.has(role.toLowerCase())) {
      seenR.add(role.toLowerCase());
      roles.rows.push({ name: role, slug: slugify(role), color: (d.roleColor || roleColors(role).bg).replace('#', '').toLowerCase() });
    }
    const tk = key(m, model).toLowerCase();
    const h = d.parentId ? 0 : Math.max(1, d.uHeight);
    if (fromNb || has(known.deviceTypes, key(m, model))) continue;
    if (seenT.has(tk)) {
      if (seenT.get(tk) !== h && h) warnings.push(`${m} ${model}: устройства с различна височина — типът е с ${seenT.get(tk)}U.`);
      continue;
    }
    seenT.set(tk, h);
    const info = input.typeInfo?.get(key(m, model));
    let slug = info?.slug ?? slugify(`${m}-${model}`);
    for (let i = 2; typeSlugs.has(slug); i++) slug = `${info?.slug ?? slugify(`${m}-${model}`)}-${i}`;
    typeSlugs.add(slug);
    types.rows.push({ manufacturer: m, model, slug, part_number: info?.part && info.part !== model ? info.part : '', u_height: h, is_full_depth: d.fullDepth === false ? 'false' : 'true' });
  }

  // --- racks ---
  const rackById = new Map(racks.map(r => [r.id, r]));
  const rackRows: CsvFile = {
    name: '07-racks.csv',
    where: 'Racks → Racks → Import',
    title: 'Нови шкафове',
    header: ['site', 'location', 'name', 'status', 'tenant', 'width', 'u_height'],
    rows: []
  };
  for (const r of racks) {
    if (r.netboxId) continue;
    rackRows.rows.push({ site, location: roomLoc.get(r.roomId) ?? '', name: r.name, status: 'active', tenant, width: 19, u_height: r.uHeight });
  }
  const rackUpd: CsvFile = { name: '08-racks-update.csv', where: 'Racks → Racks → Import (обновяване по id)', title: 'Променени шкафове', header: ['id', 'site', 'location', 'name', 'u_height'], rows: [] };
  for (const r of racks) {
    if (!r.netboxId || !r.nb) continue;
    if (r.nb.name !== r.name || r.nb.roomId !== r.roomId || r.nb.uHeight !== r.uHeight)
      rackUpd.rows.push({ id: r.netboxId, site, location: roomLoc.get(r.roomId) ?? '', name: r.name, u_height: r.uHeight });
  }

  // --- devices ---
  const devById = new Map(input.devices.map(d => [d.id, d]));
  const base = (d: Device) => {
    const { m, model } = typeOf(d);
    const rack = rackById.get(d.rackId);
    return { m, model, rack, location: rack ? roomLoc.get(rack.roomId) ?? '' : '' };
  };
  const comments = (d: Device) => {
    const parts: string[] = [];
    if (d.mgmtIp) parts.push(`IP за управление: ${d.mgmtIp}`);
    const parent = d.parentId ? devById.get(d.parentId) : undefined;
    if (parent && !d.nb?.parentId) parts.push(`Стои на/в: ${parent.name || parent.model}`);
    if (d.notes.trim()) parts.push(d.notes.trim());
    return parts.join('\n');
  };
  const newDev: CsvFile = {
    name: '09-devices.csv',
    where: 'Devices → Devices → Import',
    title: 'Нови устройства',
    header: ['name', 'role', 'tenant', 'manufacturer', 'device_type', 'status', 'site', 'location', 'rack', 'position', 'face', 'serial', 'asset_tag', 'comments'],
    rows: []
  };
  for (const d of devices) {
    if (d.netboxId) continue;
    const b = base(d);
    // Devices on a tray or shelf: in the rack without a U position (NetBox can't stack them in one U).
    const racked = !d.parentId && d.position > 0;
    newDev.rows.push({
      name: d.name.trim(),
      role: roleOf(d),
      tenant,
      manufacturer: b.m,
      device_type: b.model,
      status: 'active',
      site,
      location: b.location,
      rack: b.rack?.name ?? '',
      position: racked ? d.position : '',
      face: racked ? d.face : '',
      serial: d.serial.trim(),
      asset_tag: d.assetTag.trim(),
      comments: comments(d)
    });
  }
  const devUpd: CsvFile = {
    name: '10-devices-update.csv',
    where: 'Devices → Devices → Import (обновяване по id)',
    title: 'Променени устройства',
    header: ['id', 'name', 'role', 'manufacturer', 'device_type', 'site', 'location', 'rack', 'position', 'face', 'serial', 'asset_tag'],
    rows: []
  };
  const childUpd: CsvFile = {
    name: '11-devices-update-in-chassis.csv',
    where: 'Devices → Devices → Import (обновяване по id)',
    title: 'Променени устройства в шаси',
    header: ['id', 'name', 'role', 'manufacturer', 'device_type', 'site', 'serial', 'asset_tag'],
    rows: []
  };
  for (const d of devices) {
    if (!d.netboxId) continue;
    const changes = diff(d).filter(x => x.field !== 'mgmtIp');
    if (!changes.length) continue;
    const b = base(d);
    const common = { id: d.netboxId, name: d.name.trim(), role: roleOf(d), manufacturer: b.m, device_type: b.model, site, serial: d.serial.trim(), asset_tag: d.assetTag.trim() };
    if (d.nb?.parentId) {
      // In a device bay: NetBox keeps it with its chassis; only its own fields change.
      if (changes.some(x => ['rackId', 'position', 'face', 'parentId'].includes(x.field)))
        warnings.push(`${d.name || d.model}: е в шаси в NetBox — местенето му трябва да се направи ръчно.`);
      childUpd.rows.push(common);
      continue;
    }
    const racked = !d.parentId && d.position > 0;
    devUpd.rows.push({ ...common, location: b.location, rack: b.rack?.name ?? '', position: racked ? d.position : '', face: racked ? d.face : '' });
  }
  const ips = input.devices.filter(d => d.mgmtIp && (!d.netboxId || d.nb?.mgmtIp !== d.mgmtIp));
  if (ips.length) warnings.push(`${ips.length} IP адреса за управление са записани в коментара на устройството — в NetBox IP адресът се връзва към интерфейс, затова се въвежда ръчно.`);

  // Names: NetBox finds devices by name; duplicates and blanks need attention.
  const named = devices.filter(d => d.name.trim());
  const dup = named.filter((d, i) => named.findIndex(o => o.name.trim().toLowerCase() === d.name.trim().toLowerCase()) !== i);
  if (dup.length) warnings.push(`Устройства с еднакво име (${[...new Set(dup.map(d => d.name.trim()))].join(', ')}): NetBox ще откаже второто.`);
  const unnamed = newDev.rows.filter(r => !r.name).length;
  if (unnamed) warnings.push(`${unnamed} нови устройства са без име — NetBox ги приема, но после трудно се намират.`);
  const unchecked = input.devices.filter(d => verifyState(d) === 'pending').length;
  if (survey.verify && unchecked) warnings.push(`${unchecked} устройства от NetBox още не са проверени — за тях не се изнася нищо.`);

  const offline: CsvFile = {
    name: '12-devices-missing-offline.csv',
    where: 'Devices → Devices → Import (обновяване по id)',
    title: 'Липсващи на място → статус offline',
    optional: true,
    header: ['id', 'status'],
    rows: missing.filter(d => d.netboxId).map(d => ({ id: d.netboxId!, status: 'offline' }))
  };

  const files = [tenants, sites, locations, manufacturers, roles, types, rackRows, rackUpd, newDev, devUpd, childUpd, offline].filter(f => f.rows.length);
  return { files, warnings, missing };
}

/** Import instructions that go into the archive next to the CSV files. */
export function readme(r: ExportResult, survey: Survey, when: string): string {
  const lines = [
    `RackNotes → NetBox 4.1.11`,
    `Оглед: ${survey.tenant} · ${survey.site}`,
    `Създаден: ${when}`,
    '',
    'Внасяй файловете по ред на номерата: всеки следващ разчита на предишните.',
    'В NetBox: съответното меню → Import → раздел „Upload file“ (или постави съдържанието в „Direct import“), формат CSV.',
    'NetBox внася файла целия или нищо: ако откаже ред, нищо от файла не е записано — поправи и пусни отново.',
    'Файловете „-update“ променят съществуващи обекти по id и пипат само колоните, които са във файла.',
    ''
  ];
  for (const f of r.files) lines.push(`${f.name}  (${f.rows.length})  ${f.title}${f.optional ? ' — по желание' : ''}`, `    → ${f.where}`);
  if (r.warnings.length) lines.push('', 'Забележки:', ...r.warnings.map(w => '- ' + w));
  if (r.missing.length) lines.push('', 'Липсват на място (в NetBox не са пипнати; 12-… ги маркира offline, ако го внесеш):', ...r.missing.map(d => `- ${d.name || d.model}${d.netboxId ? ` (NetBox id ${d.netboxId})` : ''}`));
  return lines.join('\n') + '\n';
}
