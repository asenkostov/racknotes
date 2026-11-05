import { describe, expect, it } from 'vitest';
import { elevation, fittingPositions, placementError, usedUnits, type Placed } from '../src/core/rack.ts';

const dev = (id: string, position: number, uHeight: number, face: 'front' | 'rear' = 'front', fullDepth?: boolean): Placed =>
  ({ id, position, uHeight, face, fullDepth });

describe('elevation', () => {
  it('returns one free block for an empty rack', () => {
    expect(elevation(42, [], 'front')).toEqual([{ kind: 'free', top: 42, bottom: 1 }]);
  });

  it('interleaves devices and gaps top-down', () => {
    const segs = elevation(10, [dev('a', 9, 2), dev('b', 3, 1)], 'front');
    expect(segs).toEqual([
      { kind: 'device', top: 10, bottom: 9, id: 'a' },
      { kind: 'free', top: 8, bottom: 4 },
      { kind: 'device', top: 3, bottom: 3, id: 'b' },
      { kind: 'free', top: 2, bottom: 1 }
    ]);
  });

  it('shows half-depth rear devices only on the rear face', () => {
    const d = [dev('r', 5, 1, 'rear', false)];
    expect(elevation(5, d, 'front')).toEqual([{ kind: 'free', top: 5, bottom: 1 }]);
    expect(elevation(5, d, 'rear')[0]).toEqual({ kind: 'device', top: 5, bottom: 5, id: 'r' });
  });

  it('ignores unracked (0U) devices', () => {
    expect(elevation(4, [dev('pdu', 0, 1)], 'front')).toEqual([{ kind: 'free', top: 4, bottom: 1 }]);
  });
});

describe('placement', () => {
  const rack = [dev('a', 1, 4)];

  it('rejects overlaps and overflow', () => {
    expect(placementError(42, rack, dev('x', 4, 1))).toMatch(/застъпва/);
    expect(placementError(42, rack, dev('x', 42, 2))).toMatch(/U42/);
    expect(placementError(42, rack, dev('x', 5, 1))).toBeNull();
  });

  it('lets a device keep its own position when edited', () => {
    expect(placementError(42, rack, dev('a', 2, 4))).toBeNull();
  });

  it('allows half-depth devices on opposite faces', () => {
    const r = [dev('f', 10, 1, 'front', false)];
    expect(placementError(42, r, dev('b', 10, 1, 'rear', false))).toBeNull();
    expect(placementError(42, r, dev('b', 10, 1, 'rear'))).not.toBeNull();
  });

  it('lists fitting positions top-down', () => {
    expect(fittingPositions(6, [dev('a', 3, 2)], 'front', 2)).toEqual([5, 1]);
  });

  it('counts used units', () => {
    expect(usedUnits(42, [dev('a', 1, 4), dev('b', 10, 2), dev('c', 0, 1)])).toBe(6);
  });
});
