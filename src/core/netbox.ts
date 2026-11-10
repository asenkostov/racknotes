// Import from NetBox 4.1 REST API responses (JSON saved from the browser or
// fetched through the tunnel later). Pure function: JSON in, records out.
//
// Record ids are derived from NetBox ids, so importing the same data again
// (on this or another device) addresses the same records instead of
// creating duplicates, and timestamps come from NetBox, so two identical
// imports compare equal during sync.

import { baseline } from './verify.ts';
import type { Cable, CableEnd, Device, Floor, PortKind, Rack, Room, Survey } from './model.ts';
import { placementError } from './rack.ts';

type Json = Record<string, any>;

export type NetboxKind = 'racks' | 'devices' | 'device-types' | 'device-roles' | 'cables' | 'power-feeds' | 'interfaces' | 'locations' | 'unknown';

export interface NetboxFile {
  kind: NetboxKind;
  host: string;
  count: number;
  complete: boolean;
  results: Json[];
}

export interface ImportPlan {
  survey: Survey;
  floors: Floor[];
  rooms: Room[];
  racks: Rack[];
  devices: Device[];
  cables: Cable[];
  warnings: string[];
  skipped: { cables: number; devices: number };
}

const KIND_BY_PATH: Record<string, NetboxKind> = {
  'dcim/racks': 'racks',
  'dcim/devices': 'devices',
  'dcim/device-types': 'device-types',
  'dcim/device-roles': 'device-roles',
  'dcim/cables': 'cables',
  'dcim/power-feeds': 'power-feeds',
  'dcim/interfaces': 'interfaces',
  'dcim/locations': 'locations'
};

/** Recognise a NetBox list response by the URL of its first result. */
export function classify(data: unknown): NetboxFile {
  const d = data as Json;
  if (!d || typeof d !== 'object' || !Array.isArray(d.results)) throw new Error('Това не е отговор от NetBox API (липсва "results").');
  const first = d.results[0];
  const url = typeof first?.url === 'string' ? first.url : '';
  const m = url.match(/^(https?:\/\/[^/]+)\/api\/([a-z]+\/[a-z-]+)\//);
  return {
    kind: (m && KIND_BY_PATH[m[2]]) || 'unknown',
    host: m?.[1] ?? '',
    count: typeof d.count === 'number' ? d.count : d.results.length,
    complete: d.next == null && d.results.length >= (typeof d.count === 'number' ? d.count : 0),
    results: d.results
  };
}

const PORT_KIND: Record<string, PortKind> = {
  'dcim.interface': 'interface',
  'dcim.frontport': 'frontport',
  'dcim.rearport': 'rearport',
  'dcim.powerport': 'powerport',
  'dcim.poweroutlet': 'poweroutlet',
  'dcim.powerfeed': 'powerfeed',
  'dcim.consoleport': 'consoleport',
  'dcim.consoleserverport': 'consoleserverport',
  'dcim.circuittermination': 'circuittermination'
};

const ip = (a: Json | null | undefined) => (typeof a?.address === 'string' ? a.address.split('/')[0] : '');
const text = (...parts: (string | null | undefined)[]) => parts.filter(p => p && String(p).trim()).join('\n\n');

export function buildImport(files: NetboxFile[], opts: { author: string; now: string }): ImportPlan {
  const of = (k: NetboxKind) => files.filter(f => f.kind === k).flatMap(f => f.results);
  const racksJ = of('racks');
  const devicesJ = of('devices');
  const typesJ = of('device-types');
  const cablesJ = of('cables');
  const feedsJ = of('power-feeds');
  const roleColor = new Map(of('device-roles').map(r => [r.id, typeof r.color === 'string' ? r.color : '']));
  const warnings: string[] = [];

  for (const f of files) if (!f.complete) warnings.push(`Файлът с ${f.kind} е непълен (${f.results.length} от ${f.count}); отвори и следващата страница или добави limit=0.`);
  if (!racksJ.length) throw new Error('Липсва файлът с шкафовете (racks).');
  if (!devicesJ.length) warnings.push('Липсва файлът с устройствата — ще се внесат само шкафовете.');

  const site = racksJ[0].site;
  const tenant = racksJ[0].tenant ?? devicesJ[0]?.tenant;
  if (racksJ.some(r => r.site?.id !== site?.id)) warnings.push('Шкафовете са от различни обекти; огледът ще е на името на първия.');
  const sid = `nb-site-${site?.id ?? 'x'}`;

  const survey: Survey = {
    id: sid,
    createdAt: racksJ[0].created ?? opts.now,
    updatedAt: opts.now,
    netboxId: site?.id,
    tenant: tenant?.name ?? site?.name ?? 'NetBox',
    site: site?.name ?? '',
    building: '',
    status: 'imported',
    author: opts.author,
    notes: `Внесено от NetBox (${files[0]?.host ?? ''}) на ${opts.now.slice(0, 10)}. Това е изходното състояние; промените от огледа се отбелязват „за проверка“.`
  };

  // NetBox Locations become rooms on one floor; racks without a location share a default room.
  const floor: Floor = { id: `${sid}-floor`, createdAt: survey.createdAt, updatedAt: opts.now, surveyId: sid, level: 0, name: 'От NetBox' };
  const rooms = new Map<string, Room>();
  const roomFor = (loc: Json | null): Room => {
    const key = loc ? `nb-location-${loc.id}` : `${sid}-room-none`;
    let r = rooms.get(key);
    if (!r) {
      r = { id: key, createdAt: survey.createdAt, updatedAt: opts.now, surveyId: sid, floorId: floor.id, name: loc?.name ?? `${survey.site} · без помещение`, netboxId: loc?.id };
      rooms.set(key, r);
    }
    return r;
  };

  const racks: Rack[] = racksJ.map(r => ({
    id: `nb-rack-${r.id}`,
    createdAt: r.created ?? survey.createdAt,
    updatedAt: opts.now,
    netboxId: r.id,
    surveyId: sid,
    roomId: roomFor(r.location).id,
    name: r.name,
    uHeight: Math.round(r.u_height ?? 42),
    notes: text(r.description, r.comments)
  }));
  const rackById = new Map(racksJ.map(r => [r.id, `nb-rack-${r.id}`]));

  const types = new Map(typesJ.map(t => [t.id, t]));
  const devices: Device[] = [];
  let skippedDevices = 0;
  for (const d of devicesJ) {
    const rackId = d.rack ? rackById.get(d.rack.id) : undefined;
    if (!rackId) {
      skippedDevices++;
      continue;
    }
    const t = types.get(d.device_type?.id);
    if (!t) warnings.push(`${d.name}: липсва типът „${d.device_type?.model}“ във файла с типове; приемам 1U.`);
    const height = t ? Math.max(0, Math.ceil(Number(t.u_height) || 0)) : 1;
    let position = d.position == null ? 0 : Number(d.position);
    if (!Number.isInteger(position)) {
      warnings.push(`${d.name}: позиция ${position} не е цяло U; закръглям надолу.`);
      position = Math.floor(position);
    }
    if (height === 0) position = 0; // 0U devices (vertical PDUs) are never placed in a U
    const device: Device = {
      id: `nb-device-${d.id}`,
      createdAt: d.created ?? survey.createdAt,
      updatedAt: opts.now,
      netboxId: d.id,
      surveyId: sid,
      rackId,
      name: d.name ?? '',
      manufacturer: d.device_type?.manufacturer?.name ?? '',
      model: d.device_type?.model ?? '',
      ...(d.device_type?.slug ? { typeSlug: d.device_type.slug } : {}),
      role: d.role?.name ?? '',
      uHeight: Math.max(1, height),
      position,
      face: d.face?.value === 'rear' ? 'rear' : 'front',
      fullDepth: t ? !!t.is_full_depth : true,
      serial: d.serial ?? '',
      assetTag: d.asset_tag ?? '',
      mgmtIp: ip(d.primary_ip4) || ip(d.primary_ip) || ip(d.oob_ip),
      status: 'confirmed',
      notes: d.description ?? '',
      ...(d.parent_device ? { parentId: `nb-device-${d.parent_device.id}` } : {}),
      ...(roleColor.get(d.role?.id) ? { roleColor: roleColor.get(d.role?.id) } : {})
    };
    devices.push({ ...device, nb: baseline(device) });
  }

  // Overlaps that NetBox allowed (or that the export reveals) are reported, not fixed.
  for (const r of racks) {
    const inRack = devices.filter(d => d.rackId === r.id && !d.parentId);
    for (const d of inRack) {
      const err = placementError(r.uHeight, inRack, d);
      if (err) warnings.push(`${r.name} · ${d.name}: ${err}`);
    }
  }

  const known = new Map(devices.map(d => [d.netboxId, d.id]));
  const feedNames = new Map(feedsJ.map(f => [f.id, f.power_panel?.name ? `${f.name} (${f.power_panel.name})` : f.name]));
  const end = (terms: Json[]): CableEnd => {
    const t = terms[0];
    const kind = PORT_KIND[t?.object_type] ?? 'other';
    const o = t?.object ?? {};
    if (kind === 'powerfeed') return { external: feedNames.get(o.id) ?? o.name ?? 'захранваща линия', port: o.name ?? '', kind };
    const devId = known.get(o.device?.id);
    const port = terms.length > 1 ? terms.map(x => x.object?.name).join(', ') : (o.name ?? '');
    return devId ? { deviceId: devId, port, kind } : { external: o.device?.name ?? o.circuit?.cid ?? 'извън огледа', port, kind };
  };
  const cables: Cable[] = [];
  let skippedCables = 0;
  for (const c of cablesJ) {
    if (!c.a_terminations?.length || !c.b_terminations?.length) {
      skippedCables++;
      continue;
    }
    const a = end(c.a_terminations);
    const b = end(c.b_terminations);
    if (!a.deviceId && !b.deviceId) {
      skippedCables++;
      continue;
    }
    const power = c.type === 'power' || [a.kind, b.kind].some(k => k === 'powerport' || k === 'poweroutlet' || k === 'powerfeed');
    cables.push({
      id: `nb-cable-${c.id}`,
      createdAt: c.created ?? survey.createdAt,
      updatedAt: opts.now,
      netboxId: c.id,
      surveyId: sid,
      label: c.label || c.display || String(c.id),
      type: power ? 'power' : 'data',
      a,
      b,
      status: 'confirmed',
      notes: text(c.description, c.length != null ? `Дължина: ${c.length} ${c.length_unit?.label ?? ''}` : '')
    });
  }

  return { survey, floors: [floor], rooms: [...rooms.values()], racks, devices, cables, warnings, skipped: { cables: skippedCables, devices: skippedDevices } };
}

// ---------------------------------------------------------------------------
// Refreshing a survey from NetBox again ("Обнови от NetBox").

export interface Existing {
  surveys: Map<string, Survey>;
  floors: Map<string, Floor>;
  rooms: Map<string, Room>;
  racks: Map<string, Rack>;
  devices: Map<string, Device>;
}

/** Fields NetBox owns per table; everything else on an existing record was entered in RackNotes and is kept. */
const NETBOX_OWNED = {
  surveys: ['tenant', 'site', 'netboxId'],
  floors: ['netboxId'],
  rooms: ['name', 'floorId', 'netboxId'],
  racks: ['name', 'uHeight', 'roomId', 'netboxId']
} as const;

function overlay<T extends object>(existing: T | undefined, incoming: T, owned: readonly string[]): T {
  if (!existing) return incoming;
  const out = { ...existing } as Record<string, unknown>;
  for (const k of owned) if (k in incoming) out[k] = (incoming as Record<string, unknown>)[k];
  return out as T;
}

/**
 * Device refresh as a three-way merge over the verification fields: where the
 * field person changed a value (it differs from the old NetBox baseline) the
 * local value stays; otherwise NetBox's new value is taken. The baseline moves
 * to the new NetBox data, so differences stay meaningful. Marks, photos links,
 * catalog links and notes are kept.
 */
export function mergeDevice(local: Device | undefined, incoming: Device): Device {
  if (!local) return incoming;
  const oldNb = local.nb ?? baseline(local);
  const merged: Device = { ...incoming, id: local.id, createdAt: local.createdAt };
  for (const k of ['name', 'manufacturer', 'model', 'serial', 'assetTag', 'rackId', 'position', 'face', 'mgmtIp', 'role', 'parentId'] as const) {
    const changedHere = String(local[k] ?? '') !== String(oldNb[k] ?? '');
    if (changedHere) (merged as unknown as Record<string, unknown>)[k] = local[k];
  }
  if (local.verify) merged.verify = local.verify;
  else delete merged.verify;
  if (local.catalog && !incoming.catalog) merged.catalog = local.catalog;
  if (local.notes && local.notes !== incoming.notes) merged.notes = local.notes;
  if (local.status === 'check') merged.status = 'check';
  merged.nb = baseline(incoming);
  return merged;
}

/** Apply an import plan on top of what is already stored, keeping field work. */
export function mergeImport(plan: ImportPlan, existing: Existing): ImportPlan {
  return {
    ...plan,
    survey: overlay(existing.surveys.get(plan.survey.id), plan.survey, NETBOX_OWNED.surveys),
    floors: plan.floors.map(f => overlay(existing.floors.get(f.id), f, NETBOX_OWNED.floors)),
    rooms: plan.rooms.map(r => overlay(existing.rooms.get(r.id), r, NETBOX_OWNED.rooms)),
    racks: plan.racks.map(r => overlay(existing.racks.get(r.id), r, NETBOX_OWNED.racks)),
    devices: plan.devices.map(d => mergeDevice(existing.devices.get(d.id), d))
  };
}
