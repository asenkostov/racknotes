// Room plan geometry: rack footprints, placement, service clearance checks.
// Units: metres. Origin: top-left inner corner of the room; x → right, y → down.

import type { Door, Facing, Rack, RackDoor, Room } from './model.ts';

export const DEFAULT_RACK_MM = { width: 600, depth: 1000 };
export const MIN_FRONT_M = 1.0;
export const MIN_REAR_M = 0.6;
export const SNAP_M = 0.1;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const round = (v: number, step = SNAP_M) => Math.round(v / step) * step;
/** Two decimals, avoids 0.30000000000000004 in stored data. */
export const tidy = (v: number) => Math.round(v * 100) / 100;

/** Footprint on the plan: width along the front, depth away from it. */
export function footprint(rack: Pick<Rack, 'widthMm' | 'depthMm' | 'plan'>): Box | null {
  if (!rack.plan) return null;
  const w = (rack.widthMm ?? DEFAULT_RACK_MM.width) / 1000;
  const d = (rack.depthMm ?? DEFAULT_RACK_MM.depth) / 1000;
  const across = rack.plan.facing === 'up' || rack.plan.facing === 'down';
  return { x: rack.plan.x, y: rack.plan.y, w: across ? w : d, h: across ? d : w };
}

/** Keep a footprint inside the room. */
export function clampInto(box: Box, room: { widthM: number; depthM: number }): { x: number; y: number } {
  return {
    x: tidy(Math.min(Math.max(0, box.x), Math.max(0, room.widthM - box.w))),
    y: tidy(Math.min(Math.max(0, box.y), Math.max(0, room.depthM - box.h)))
  };
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;

const opposite: Record<Facing, Facing> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/**
 * Free distance from one side of a box to the nearest wall or other rack,
 * measured across the full width of that side.
 */
export function clearance(box: Box, side: Facing, others: Box[], room: { widthM: number; depthM: number }): number {
  let free: number;
  let blocks: (o: Box) => number | null;
  const spanX = (o: Box) => o.x < box.x + box.w - 1e-9 && box.x < o.x + o.w - 1e-9;
  const spanY = (o: Box) => o.y < box.y + box.h - 1e-9 && box.y < o.y + o.h - 1e-9;
  switch (side) {
    case 'up':
      free = box.y;
      blocks = o => (spanX(o) && o.y + o.h <= box.y + 1e-9 ? box.y - (o.y + o.h) : null);
      break;
    case 'down':
      free = room.depthM - (box.y + box.h);
      blocks = o => (spanX(o) && o.y >= box.y + box.h - 1e-9 ? o.y - (box.y + box.h) : null);
      break;
    case 'left':
      free = box.x;
      blocks = o => (spanY(o) && o.x + o.w <= box.x + 1e-9 ? box.x - (o.x + o.w) : null);
      break;
    case 'right':
      free = room.widthM - (box.x + box.w);
      blocks = o => (spanY(o) && o.x >= box.x + box.w - 1e-9 ? o.x - (box.x + box.w) : null);
      break;
  }
  for (const o of others) {
    const d = blocks(o);
    if (d != null) free = Math.min(free, d);
  }
  return tidy(Math.max(0, free));
}

export interface PlanIssue {
  level: 'ok' | 'warn' | 'error';
  rackId?: string;
  text: string;
}

const fmt = (m: number) => m.toFixed(2).replace('.', ',') + ' m';

/** Door swing area: a square in front of the door inside the room. */
export function doorBox(door: Door, room: { widthM: number; depthM: number }): Box {
  switch (door.wall) {
    case 'top':
      return { x: door.offset, y: 0, w: door.width, h: door.width };
    case 'bottom':
      return { x: door.offset, y: room.depthM - door.width, w: door.width, h: door.width };
    case 'left':
      return { x: 0, y: door.offset, w: door.width, h: door.width };
    case 'right':
      return { x: room.widthM - door.width, y: door.offset, w: door.width, h: door.width };
  }
}

type Vec = { x: number; y: number };
/** One door leaf swinging out of a rack face: quarter circle from the hinge. */
export interface Swing {
  side: 'front' | 'rear';
  hinge: Vec;
  /** Unit vector along the face, from the hinge towards the closing edge. */
  along: Vec;
  /** Unit vector out of the face. */
  out: Vec;
  r: number;
}

const NORMAL: Record<Facing, Vec> = { down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, left: { x: -1, y: 0 } };
/** "Right hand" along the front face for someone standing in front of it. */
const RIGHT: Record<Facing, Vec> = { down: { x: 1, y: 0 }, up: { x: -1, y: 0 }, right: { x: 0, y: -1 }, left: { x: 0, y: 1 } };

export const doorLabel: Record<RackDoor, string> = { none: 'няма', left: 'една, панти отляво', right: 'една, панти отдясно', double: 'двукрила' };

/** Door leaves of a placed rack, in plan coordinates. */
export function rackSwings(rack: Pick<Rack, 'widthMm' | 'depthMm' | 'plan' | 'doors'>): Swing[] {
  const b = footprint(rack);
  if (!b || !rack.plan) return [];
  const w = (rack.widthMm ?? DEFAULT_RACK_MM.width) / 1000;
  const d = (rack.depthMm ?? DEFAULT_RACK_MM.depth) / 1000;
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const n = NORMAL[rack.plan.facing];
  const u = RIGHT[rack.plan.facing];
  const out: Swing[] = [];
  for (const side of ['front', 'rear'] as const) {
    const kind = rack.doors?.[side];
    if (!kind || kind === 'none') continue;
    const o = side === 'front' ? n : { x: -n.x, y: -n.y };
    // Seen from behind, the viewer's right hand points the other way.
    const right = side === 'front' ? u : { x: -u.x, y: -u.y };
    const face = { x: c.x + (o.x * d) / 2, y: c.y + (o.y * d) / 2 };
    const edge = (s: number) => ({ x: face.x + (s * right.x * w) / 2, y: face.y + (s * right.y * w) / 2 });
    const leaf = (hingeSide: -1 | 1, r: number): Swing => ({ side, hinge: edge(hingeSide), along: { x: -hingeSide * right.x, y: -hingeSide * right.y }, out: o, r });
    if (kind === 'left') out.push(leaf(-1, w));
    else if (kind === 'right') out.push(leaf(1, w));
    else out.push(leaf(-1, w / 2), leaf(1, w / 2));
  }
  return out;
}

/** Points of a door swing (hinge first), for drawing as a filled fan. */
export function swingPoints(s: Swing, steps = 12): Vec[] {
  const pts: Vec[] = [s.hinge];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2);
    pts.push({ x: s.hinge.x + s.r * (Math.cos(t) * s.along.x + Math.sin(t) * s.out.x), y: s.hinge.y + s.r * (Math.cos(t) * s.along.y + Math.sin(t) * s.out.y) });
  }
  return pts;
}

/** Checks a field engineer cares about: inside the room, no overlaps, service space, door not blocked. */
export function checkPlan(room: Room, racks: Rack[]): PlanIssue[] {
  if (!room.widthM || !room.depthM) return [];
  const dims = { widthM: room.widthM, depthM: room.depthM };
  const placed = racks.map(r => ({ r, b: footprint(r) })).filter((x): x is { r: Rack; b: Box } => !!x.b);
  const out: PlanIssue[] = [];
  for (const { r, b } of placed) {
    if (b.x < -1e-9 || b.y < -1e-9 || b.x + b.w > dims.widthM + 1e-9 || b.y + b.h > dims.depthM + 1e-9)
      out.push({ level: 'error', rackId: r.id, text: `${r.name} излиза извън помещението.` });
    for (const o of placed) if (o.r.id > r.id && overlaps(b, o.b)) out.push({ level: 'error', rackId: r.id, text: `${r.name} се застъпва с ${o.r.name}.` });
    const others = placed.filter(o => o.r.id !== r.id).map(o => o.b);
    const front = clearance(b, r.plan!.facing, others, dims);
    const rear = clearance(b, opposite[r.plan!.facing], others, dims);
    out.push(
      front < MIN_FRONT_M
        ? { level: 'warn', rackId: r.id, text: `${r.name}: отпред има само ${fmt(front)} (препоръчително поне ${fmt(MIN_FRONT_M)}).` }
        : { level: 'ok', rackId: r.id, text: `${r.name}: отпред ${fmt(front)} свободно.` }
    );
    out.push(
      rear < MIN_REAR_M
        ? { level: 'warn', rackId: r.id, text: `${r.name}: отзад има само ${fmt(rear)} (препоръчително поне ${fmt(MIN_REAR_M)}).` }
        : { level: 'ok', rackId: r.id, text: `${r.name}: отзад ${fmt(rear)} свободно.` }
    );
    for (const side of ['front', 'rear'] as const) {
      const leaf = rackSwings(r).find(s => s.side === side)?.r;
      const free = side === 'front' ? front : rear;
      if (leaf && free + 1e-9 < leaf)
        out.push({ level: 'warn', rackId: r.id, text: `${r.name}: вратата ${side === 'front' ? 'отпред' : 'отзад'} не може да се отвори докрай (нужни ${fmt(leaf)}, има ${fmt(free)}).` });
    }
    for (const d of room.doors ?? []) if (overlaps(b, doorBox(d, dims))) out.push({ level: 'warn', rackId: r.id, text: `${r.name} пречи на отварянето на вратата.` });
  }
  return out;
}

/** First free spot for a new rack: scan rows along the top wall, front facing down. */
export function firstFreeSpot(room: { widthM: number; depthM: number }, size: { widthMm?: number; depthMm?: number }, others: Box[]): { x: number; y: number; facing: Facing } {
  const w = (size.widthMm ?? DEFAULT_RACK_MM.width) / 1000;
  const d = (size.depthMm ?? DEFAULT_RACK_MM.depth) / 1000;
  // Leave the recommended service gap behind the rack first; squeeze closer only if nothing fits.
  for (const y0 of [MIN_REAR_M, 0])
    for (let y = y0; y + d <= room.depthM + 1e-9; y = tidy(y + SNAP_M))
      for (let x = 0.2; x + w <= room.widthM + 1e-9; x = tidy(x + SNAP_M)) {
        const b = { x, y, w, h: d };
        if (!others.some(o => overlaps(b, o))) return { x: tidy(x), y: tidy(y), facing: 'down' };
      }
  return { x: 0, y: 0, facing: 'down' };
}
