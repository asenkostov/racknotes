// Rack elevation logic: occupancy, free ranges and placement checks.
// Pure functions, no I/O, covered by tests/rack.test.ts.

export interface Placed {
  id: string;
  position: number; // lowest U occupied, 1-based; 0 = not racked
  uHeight: number;
  face: 'front' | 'rear';
  /** Full-depth devices block both faces. Default true (conservative). */
  fullDepth?: boolean;
}

export type Segment =
  | { kind: 'device'; top: number; bottom: number; id: string }
  | { kind: 'free'; top: number; bottom: number };

const occupies = (d: Placed, face: 'front' | 'rear') =>
  d.position > 0 && (d.face === face || d.fullDepth !== false);

/** Top-down list of device blocks and free gaps for one face. */
export function elevation(rackHeight: number, devices: Placed[], face: 'front' | 'rear'): Segment[] {
  const shown = devices
    .filter(d => occupies(d, face))
    .sort((a, b) => b.position - a.position);
  const out: Segment[] = [];
  let cursor = rackHeight;
  for (const d of shown) {
    const top = Math.min(d.position + d.uHeight - 1, rackHeight);
    if (top < cursor) out.push({ kind: 'free', top: cursor, bottom: top + 1 });
    if (top <= cursor) out.push({ kind: 'device', top, bottom: d.position, id: d.id });
    cursor = Math.min(cursor, d.position - 1);
  }
  if (cursor >= 1) out.push({ kind: 'free', top: cursor, bottom: 1 });
  return out;
}

export function usedUnits(rackHeight: number, devices: Placed[]): number {
  const used = new Set<number>();
  for (const d of devices) {
    if (d.position <= 0) continue;
    for (let u = d.position; u < d.position + d.uHeight && u <= rackHeight; u++) used.add(u);
  }
  return used.size;
}

/** Returns an error message in Bulgarian, or null when the placement is valid. */
export function placementError(
  rackHeight: number,
  devices: Placed[],
  candidate: Placed
): string | null {
  if (!Number.isInteger(candidate.uHeight) || candidate.uHeight < 1 || candidate.uHeight > 60)
    return 'Височината трябва да е между 1 и 60 U.';
  if (candidate.position === 0) return null;
  if (!Number.isInteger(candidate.position) || candidate.position < 1)
    return 'Невалидна U позиция.';
  if (candidate.position + candidate.uHeight - 1 > rackHeight)
    return `Устройството излиза над U${rackHeight}.`;
  for (const d of devices) {
    if (d.id === candidate.id || d.position <= 0) continue;
    const sameSpace =
      d.face === candidate.face || d.fullDepth !== false || candidate.fullDepth !== false;
    const overlap =
      candidate.position < d.position + d.uHeight && d.position < candidate.position + candidate.uHeight;
    if (sameSpace && overlap) return 'Позицията се застъпва с друго устройство.';
  }
  return null;
}

/** Lowest free positions (bottom U) where a device of `height` U fits, top-down. */
export function fittingPositions(
  rackHeight: number,
  devices: Placed[],
  face: 'front' | 'rear',
  height: number,
  ignoreId?: string
): number[] {
  const out: number[] = [];
  for (let p = rackHeight - height + 1; p >= 1; p--) {
    const err = placementError(rackHeight, devices, {
      id: ignoreId ?? '__candidate__',
      position: p,
      uHeight: height,
      face
    });
    if (!err) out.push(p);
  }
  return out;
}

export const uLabel = (top: number, bottom: number) => (top === bottom ? `U${top}` : `U${top}–${bottom}`);
