import { describe, expect, it } from 'vitest';
import { rectFrom, roomBounds, rotateInPlace, scaleFrom, toFloor } from '../src/core/floorplan.ts';

const room = (rot: 0 | 90 | 180 | 270) => ({ widthM: 4, depthM: 3, floor: { x: 10, y: 5, rot } });

describe('floor plan', () => {
  it('maps room points to the floor for every turn', () => {
    expect(toFloor(room(0), { x: 4, y: 3 })).toEqual({ x: 14, y: 8 });
    expect(toFloor(room(90), { x: 4, y: 0 })).toEqual({ x: 10, y: 9 });
    expect(toFloor(room(180), { x: 4, y: 3 })).toEqual({ x: 6, y: 2 });
    expect(toFloor(room(270), { x: 0, y: 3 })).toEqual({ x: 13, y: 5 });
  });

  it('computes bounds and turns in place around the centre', () => {
    expect(roomBounds(room(0))).toEqual({ x: 10, y: 5, w: 4, h: 3 });
    expect(roomBounds(room(90))).toEqual({ x: 7, y: 5, w: 3, h: 4 });
    const turned = { ...room(0), floor: rotateInPlace(room(0)) };
    const b = roomBounds(turned)!;
    expect(turned.floor.rot).toBe(90);
    expect([b.x + b.w / 2, b.y + b.h / 2]).toEqual([12, 6.5]);
    expect([b.w, b.h]).toEqual([3, 4]);
  });

  it('builds rectangles and scales', () => {
    expect(rectFrom({ x: 5, y: 1 }, { x: 2, y: 4 })).toEqual({ x: 2, y: 1, w: 3, h: 3 });
    expect(scaleFrom({ x: 0, y: 0 }, { x: 300, y: 400 }, 10)).toBeCloseTo(0.02);
    expect(scaleFrom({ x: 0, y: 0 }, { x: 1, y: 1 }, 10)).toBeNull();
  });
});
