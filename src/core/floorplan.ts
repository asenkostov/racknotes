// Floor plan geometry: rooms placed on a floor drawing.
// Floor coordinates: metres, origin top-left of the drawing, x → right, y → down.
// A room keeps its own plan coordinates (see plan.ts); on the floor it is
// moved to room.floor.{x,y} and turned clockwise by room.floor.rot.

import type { Room, Rot } from './model.ts';

export interface Pt {
  x: number;
  y: number;
}

/** Room-local point (metres) to floor metres. */
export function toFloor(room: Pick<Room, 'floor'>, p: Pt): Pt {
  const f = room.floor ?? { x: 0, y: 0, rot: 0 };
  switch (f.rot) {
    case 90:
      return { x: f.x - p.y, y: f.y + p.x };
    case 180:
      return { x: f.x - p.x, y: f.y - p.y };
    case 270:
      return { x: f.x + p.y, y: f.y - p.x };
    default:
      return { x: f.x + p.x, y: f.y + p.y };
  }
}

/** Axis-aligned bounds of a placed room on the floor. */
export function roomBounds(room: Pick<Room, 'floor' | 'widthM' | 'depthM'>): { x: number; y: number; w: number; h: number } | null {
  if (!room.floor || !room.widthM || !room.depthM) return null;
  const pts = [
    { x: 0, y: 0 },
    { x: room.widthM, y: 0 },
    { x: room.widthM, y: room.depthM },
    { x: 0, y: room.depthM }
  ].map(p => toFloor(room, p));
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/**
 * Turn a room 90° clockwise about its centre, so it stays where it is on the drawing.
 */
export function rotateInPlace(room: Pick<Room, 'floor' | 'widthM' | 'depthM'>): { x: number; y: number; rot: Rot } {
  const b = roomBounds(room)!;
  const rot = (((room.floor?.rot ?? 0) + 90) % 360) as Rot;
  const next = { ...room, floor: { x: 0, y: 0, rot } };
  const nb = roomBounds(next)!;
  // Shift so the new bounds share the old centre.
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return { x: round2(cx - (nb.x + nb.w / 2)), y: round2(cy - (nb.y + nb.h / 2)), rot };
}

/** Rectangle from two opposite corners (any order). */
export function rectFrom(a: Pt, b: Pt) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Metres per pixel from a calibration line drawn in drawing pixels. */
export function scaleFrom(a: Pt, b: Pt, metres: number): number | null {
  const px = Math.hypot(a.x - b.x, a.y - b.y);
  if (!(px > 5) || !(metres > 0)) return null;
  return metres / px;
}

export const round2 = (v: number) => Math.round(v * 100) / 100;
