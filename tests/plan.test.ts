import { describe, expect, it } from 'vitest';
import { checkPlan, clampInto, clearance, firstFreeSpot, footprint, rackSwings } from '../src/core/plan.ts';
import type { Rack, Room } from '../src/core/model.ts';

const room: Room = { id: 'room', surveyId: 's', floorId: 'f', name: 'R', createdAt: '', updatedAt: '', widthM: 6, depthM: 4.5 };
const rack = (id: string, x: number, y: number, facing: 'up' | 'down' | 'left' | 'right', extra: Partial<Rack> = {}): Rack => ({
  id, name: id, surveyId: 's', roomId: 'room', uHeight: 48, notes: '', createdAt: '', updatedAt: '',
  widthMm: 600, depthMm: 1200, plan: { x, y, facing }, ...extra
});

describe('footprint', () => {
  it('swaps width and depth when the front faces sideways', () => {
    expect(footprint(rack('a', 1, 1, 'down'))).toEqual({ x: 1, y: 1, w: 0.6, h: 1.2 });
    expect(footprint(rack('a', 1, 1, 'left'))).toEqual({ x: 1, y: 1, w: 1.2, h: 0.6 });
    expect(footprint({ widthMm: 600, depthMm: 1000 })).toBeNull();
  });
});

describe('clearance', () => {
  const dims = { widthM: 6, depthM: 4.5 };
  it('measures to the wall and to the nearest rack in front', () => {
    const b = footprint(rack('a', 1, 0.4, 'down'))!;
    expect(clearance(b, 'down', [], dims)).toBe(2.9);
    expect(clearance(b, 'up', [], dims)).toBe(0.4);
    const other = footprint(rack('b', 1.2, 2.5, 'up'))!;
    expect(clearance(b, 'down', [other], dims)).toBe(0.9);
    const aside = footprint(rack('c', 3, 2.5, 'up'))!;
    expect(clearance(b, 'down', [aside], dims)).toBe(2.9);
  });
});

describe('checkPlan', () => {
  it('reports overlap, outside and tight service space', () => {
    const issues = checkPlan(room, [rack('a', 0, 0, 'up'), rack('b', 0.3, 0.5, 'down'), rack('c', 5.8, 1, 'down')]);
    const text = issues.map(i => `${i.level}:${i.text}`).join('\n');
    expect(text).toMatch(/error:a се застъпва с b/);
    expect(text).toMatch(/error:c излиза извън/);
    expect(text).toMatch(/warn:a: отпред има само 0,00 m/);
  });

  it('is happy with a sensible layout and flags a blocked door', () => {
    const ok = checkPlan({ ...room, doors: [{ wall: 'bottom', offset: 4, width: 0.9 }] }, [rack('a', 2.4, 0.8, 'down'), rack('b', 3.0, 0.8, 'down')]);
    expect(ok.filter(i => i.level !== 'ok')).toEqual([]);
    const blocked = checkPlan({ ...room, doors: [{ wall: 'bottom', offset: 4, width: 0.9 }] }, [rack('a', 4.2, 3.2, 'up')]);
    expect(blocked.some(i => /вратата/.test(i.text))).toBe(true);
  });

  it('ignores rooms without size', () => {
    expect(checkPlan({ ...room, widthM: undefined }, [rack('a', 0, 0, 'up')])).toEqual([]);
  });
});

describe('placement helpers', () => {
  it('clamps into the room and finds a free spot', () => {
    expect(clampInto({ x: 5.9, y: -1, w: 0.6, h: 1.2 }, { widthM: 6, depthM: 4.5 })).toEqual({ x: 5.4, y: 0 });
    const taken = [footprint(rack('a', 0.2, 0.2, 'down'))!];
    expect(firstFreeSpot({ widthM: 6, depthM: 4.5 }, { widthMm: 600, depthMm: 1200 }, taken)).toEqual({ x: 0.8, y: 0.6, facing: 'down' });
  });
});

describe('rack doors', () => {
  it('puts hinges on the correct side for each facing', () => {
    // Facing down: standing below the rack looking up, left hinge is at smaller x.
    const down = rackSwings(rack('a', 1, 1, 'down', { doors: { front: 'left' } }));
    expect(down).toHaveLength(1);
    expect(down[0]).toMatchObject({ side: 'front', hinge: { x: 1, y: 2.2 }, along: { x: 1, y: 0 }, out: { x: 0, y: 1 }, r: 0.6 });
    // Facing right: front edge at x = 1 + 1.2; left hinge is the lower one (larger y).
    const right = rackSwings(rack('b', 1, 1, 'right', { doors: { front: 'left' } }));
    expect(right[0].hinge).toEqual({ x: 2.2, y: 1.6 });
    // Rear double door: two leaves of half width.
    const rear = rackSwings(rack('c', 1, 1, 'down', { doors: { rear: 'double' } }));
    expect(rear.map(s => s.r)).toEqual([0.3, 0.3]);
    expect(rear.every(s => s.out.y === -1 && s.hinge.y === 1)).toBe(true);
  });

  it('warns when a door cannot open fully', () => {
    const r = rack('a', 1, 0.4, 'down', { doors: { front: 'right', rear: 'left' } });
    const texts = checkPlan(room, [r]).map(i => i.text);
    expect(texts.some(t => t.includes('вратата отзад не може'))).toBe(true);
    expect(texts.some(t => t.includes('вратата отпред'))).toBe(false);
  });
});
