import { describe, expect, it } from 'vitest';
import { elevation, fittingPositions, placementError, usedUnits, type Placed, nearestFit, tappedU } from '../src/core/rack.ts';

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

describe('moving by tapping free space', () => {
  const rackH = 42;
  const sw = { id: 'sw', position: 10, uHeight: 1, face: 'front' as const };
  const srv = { id: 'srv', position: 20, uHeight: 2, face: 'front' as const };
  const devs = [sw, srv];

  it('finds the U under the finger anywhere in the gap, not only its top', () => {
    // Gap U11–19 drawn 20px per U: a tap 80px below its top is U15.
    expect(tappedU(19, 11, 80, 20)).toBe(15);
    expect(tappedU(19, 11, 0, 20)).toBe(19);
    expect(tappedU(19, 11, 500, 20)).toBe(11);
    expect(tappedU(19, 11, -5, 20)).toBe(19);
  });

  it('puts a 1U device exactly where tapped', () => {
    expect(nearestFit(rackH, devs, sw, 19, 11, 15)).toBe(15);
  });

  it('puts a 2U device with its top at the tapped U, shifted down when it would collide', () => {
    expect(nearestFit(rackH, devs, { id: 'x', position: 0, uHeight: 2, face: 'front' }, 19, 11, 15)).toBe(14);
    // Tapping U19 directly under srv (U20–21): top at U19 → position 18.
    expect(nearestFit(rackH, devs, { id: 'x', position: 0, uHeight: 2, face: 'front' }, 19, 11, 19)).toBe(18);
  });

  it('says no when the device is taller than the gap', () => {
    const low = { id: 'low', position: 6, uHeight: 1, face: 'front' as const }; // gap U7–9
    expect(nearestFit(rackH, [...devs, low], { id: 'x', position: 0, uHeight: 4, face: 'front' }, 9, 7, 8)).toBeNull();
  });
});
