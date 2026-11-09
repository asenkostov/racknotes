// 3D view of one room: walls with door openings, racks at their real size and
// placement, with the device fronts painted on. Loaded on demand (three.js is big).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Device, Door, Facing, Rack, Room } from '../../core/model.ts';
import { DEFAULT_RACK_MM, MIN_FRONT_M, MIN_REAR_M, footprint } from '../../core/plan.ts';
import { elevation } from '../../core/rack.ts';
import { roleColors } from '../../core/roles.ts';

export const U_M = 0.04445;
const WALL_H = 2.6;
const WALL_T = 0.1;
const DOOR_H = 2.1;
/** Plinth + top cover added to the U space of a rack. */
const RACK_EXTRA_M = 0.15;
export type View = 'iso' | 'top' | 'front';

export interface SceneData {
  room: Room;
  racks: Rack[];
  devices: Device[];
  flagged: Set<string>;
}

const ROT: Record<Facing, number> = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 };

/** Canvas texture of one rack face, devices drawn in their role colour. */
function faceTexture(rack: Rack, devices: Device[], face: 'front' | 'rear'): THREE.CanvasTexture {
  const px = 24; // per U
  const pad = 14;
  const W = 240;
  const H = rack.uHeight * px + pad * 2;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1B2A31';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#0F1A1F';
  g.fillRect(16, pad, W - 32, rack.uHeight * px);
  const byId = new Map(devices.map(d => [d.id, d]));
  for (const s of elevation(rack.uHeight, devices.filter(d => !d.parentId), face)) {
    const y = pad + (rack.uHeight - s.top) * px;
    const h = (s.top - s.bottom + 1) * px;
    if (s.kind === 'free') {
      g.strokeStyle = '#26363D';
      for (let u = 0; u < s.top - s.bottom + 1; u++) g.strokeRect(20, y + u * px + 2, W - 40, px - 4);
      continue;
    }
    const d = byId.get(s.id)!;
    const own = d.face === face;
    const col = roleColors(d.role, d.roleColor);
    g.fillStyle = own ? col.bg : '#3A474D';
    g.fillRect(18, y + 1, W - 36, h - 2);
    if (h >= 18) {
      g.fillStyle = own ? col.fg : '#AEB8BC';
      g.font = `600 ${Math.min(16, h - 6)}px "IBM Plex Mono", monospace`;
      g.textBaseline = 'middle';
      const label = own ? d.name || d.model || '—' : 'отзад';
      g.fillText(label.length > 20 ? label.slice(0, 19) + '…' : label, 26, y + h / 2, W - 52);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function label(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = '600 44px "IBM Plex Mono", monospace';
  const w = Math.ceil(g.measureText(text).width) + 36;
  c.width = w;
  c.height = 68;
  g.fillStyle = 'rgba(19,35,43,0.88)';
  g.beginPath();
  g.roundRect(0, 0, w, 68, 14);
  g.fill();
  g.fillStyle = '#fff';
  g.font = '600 44px "IBM Plex Mono", monospace';
  g.textBaseline = 'middle';
  g.fillText(text, 18, 36);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  s.scale.set((0.32 * w) / 68, 0.32, 1);
  s.renderOrder = 10;
  return s;
}

/** Wall pieces along one wall, leaving gaps for doors (with a lintel above). */
function wallPieces(len: number, doors: Door[]): { from: number; to: number; y0: number; y1: number }[] {
  const out: { from: number; to: number; y0: number; y1: number }[] = [];
  let at = 0;
  for (const d of [...doors].sort((a, b) => a.offset - b.offset)) {
    if (d.offset > at) out.push({ from: at, to: d.offset, y0: 0, y1: WALL_H });
    out.push({ from: d.offset, to: d.offset + d.width, y0: DOOR_H, y1: WALL_H });
    at = Math.max(at, d.offset + d.width);
  }
  if (at < len) out.push({ from: at, to: len, y0: 0, y1: WALL_H });
  return out;
}

export function createRoomScene(canvas: HTMLCanvasElement, onPick: (rackId: string | null) => void) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0xf2f4f3);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.minDistance = 0.8;
  controls.maxDistance = 60;
  controls.screenSpacePanning = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c2c0, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(3, 8, 5);
  scene.add(sun);

  const content = new THREE.Group();
  scene.add(content);
  const rackMeshes = new Map<string, THREE.Mesh>();
  let size = { w: 4, d: 3 };
  let selected: string | null = null;
  let zones: THREE.Group | null = null;
  let showZones = true;
  const wallGroups: { side: Door['wall']; g: THREE.Group }[] = [];

  // Walls between the camera and the room are hidden, so you always look in.
  function cullWalls() {
    const c = camera.position;
    const out = { top: c.z < -size.d / 2, bottom: c.z > size.d / 2, left: c.x < -size.w / 2, right: c.x > size.w / 2 };
    const fromAbove = c.y > WALL_H * 1.6 && Math.abs(c.x) < size.w && Math.abs(c.z) < size.d;
    for (const w of wallGroups) w.g.visible = fromAbove || !out[w.side];
  }
  const render = () => {
    cullWalls();
    renderer.render(scene, camera);
  };
  controls.addEventListener('change', render);

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  function disposeGroup(g: THREE.Object3D) {
    g.traverse(o => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        (mat as THREE.MeshStandardMaterial).map?.dispose();
        mat.dispose();
      }
    });
  }

  function update(data: SceneData) {
    disposeGroup(content);
    content.clear();
    rackMeshes.clear();
    wallGroups.length = 0;
    const { room } = data;
    const W = room.widthM ?? 4;
    const D = room.depthM ?? 3;
    size = { w: W, d: D };
    // Plan (x right, y down) -> scene (x right, z toward the viewer), centred.
    const at = (x: number, y: number) => new THREE.Vector3(x - W / 2, 0, y - D / 2);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    content.add(floor);
    const grid = new THREE.GridHelper(Math.max(W, D), Math.round(Math.max(W, D) / 0.5), 0xd5dcda, 0xe3e8e6);
    grid.position.y = 0.002;
    grid.scale.set(W / Math.max(W, D), 1, D / Math.max(W, D));
    content.add(grid);

    // Walls: drawn outside the inner size so room dimensions stay exact.
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xc9d1ce, transparent: true, opacity: 0.35, depthWrite: false });
    const doorsOn = (w: Door['wall']) => (room.doors ?? []).filter(d => d.wall === w);
    const walls: [Door['wall'], number][] = [['top', W], ['bottom', W], ['left', D], ['right', D]];
    for (const [w, len] of walls) {
      const group = new THREE.Group();
      content.add(group);
      wallGroups.push({ side: w, g: group });
      for (const p of wallPieces(len, doorsOn(w))) {
        const l = p.to - p.from;
        const h = p.y1 - p.y0;
        const horiz = w === 'top' || w === 'bottom';
        const m = new THREE.Mesh(new THREE.BoxGeometry(horiz ? l : WALL_T, h, horiz ? WALL_T : l), wallMat);
        const mid = p.from + l / 2;
        const c = horiz ? at(mid, w === 'top' ? -WALL_T / 2 : D + WALL_T / 2) : at(w === 'left' ? -WALL_T / 2 : W + WALL_T / 2, mid);
        m.position.set(c.x, p.y0 + h / 2, c.z);
        group.add(m);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x8a979c }));
        edges.position.copy(m.position);
        group.add(edges);
      }
    }
    // Door swing on the floor: quarter circle from the hinge, into the room.
    for (const d of room.doors ?? []) {
      const geo = {
        top: { h: [d.offset, 0], along: [1, 0], into: [0, 1] },
        bottom: { h: [d.offset, D], along: [1, 0], into: [0, -1] },
        left: { h: [0, d.offset], along: [0, 1], into: [1, 0] },
        right: { h: [W, d.offset], along: [0, 1], into: [-1, 0] }
      }[d.wall];
      const pts: number[] = [];
      const steps = 20;
      for (let i = 0; i < steps; i++) {
        const p = (t: number) => at(geo.h[0] + d.width * (Math.cos(t) * geo.along[0] + Math.sin(t) * geo.into[0]), geo.h[1] + d.width * (Math.cos(t) * geo.along[1] + Math.sin(t) * geo.into[1]));
        const h = at(geo.h[0], geo.h[1]);
        const p1 = p((i / steps) * (Math.PI / 2));
        const p2 = p(((i + 1) / steps) * (Math.PI / 2));
        pts.push(h.x, 0.004, h.z, p1.x, 0.004, p1.z, p2.x, 0.004, p2.z);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      content.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xf08a4b, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false })));
    }

    // Racks.
    zones = new THREE.Group();
    zones.visible = showZones;
    content.add(zones);
    for (const r of data.racks) {
      const b = footprint(r);
      if (!b || !r.plan) continue;
      const devs = data.devices.filter(d => d.rackId === r.id);
      const w = (r.widthMm ?? DEFAULT_RACK_MM.width) / 1000;
      const dp = (r.depthMm ?? DEFAULT_RACK_MM.depth) / 1000;
      const h = r.uHeight * U_M + RACK_EXTRA_M;
      const body = new THREE.MeshStandardMaterial({ color: 0x2b3a40, roughness: 0.7 });
      const front = new THREE.MeshStandardMaterial({ map: faceTexture(r, devs, 'front'), roughness: 0.6 });
      const rear = new THREE.MeshStandardMaterial({ map: faceTexture(r, devs, 'rear'), roughness: 0.6 });
      // BoxGeometry material order: +x, -x, +y, -y, +z (front), -z (rear)
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, dp), [body, body, body, body, front, rear]);
      const c = at(b.x + b.w / 2, b.y + b.h / 2);
      mesh.position.set(c.x, h / 2, c.z);
      mesh.rotation.y = ROT[r.plan.facing];
      mesh.userData.rackId = r.id;
      content.add(mesh);
      rackMeshes.set(r.id, mesh);
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: data.flagged.has(r.id) ? 0xc2410c : 0x13232b })
      );
      mesh.add(edge);
      const tag = label(r.name);
      tag.position.set(0, h / 2 + 0.25, 0);
      mesh.add(tag);

      // Service zones: front (blue) and rear (grey), in the rack's own frame.
      const zone = (depth: number, color: number, sign: 1 | -1) => {
        const z = new THREE.Mesh(new THREE.PlaneGeometry(w, depth), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false }));
        z.rotation.x = -Math.PI / 2;
        const holder = new THREE.Group();
        holder.position.set(c.x, 0.006, c.z);
        holder.rotation.y = ROT[r.plan!.facing];
        z.position.set(0, 0, sign * (dp / 2 + depth / 2));
        holder.add(z);
        zones!.add(holder);
      };
      zone(MIN_FRONT_M, 0x3b82f6, 1);
      zone(MIN_REAR_M, 0x8a979c, -1);
    }
    highlight();
    if (!camera.userData.placed) view('iso');
    else render();
  }

  function highlight() {
    for (const [id, m] of rackMeshes) {
      const mats = m.material as THREE.MeshStandardMaterial[];
      mats[0].emissive.set(id === selected ? 0xf08a4b : 0x000000);
      mats[0].emissiveIntensity = id === selected ? 0.35 : 0;
    }
    render();
  }

  function view(v: View) {
    // Portrait screens need more distance to fit the whole room in.
    const span = Math.max(size.w, size.d) * Math.max(1, 1.35 / camera.aspect);
    controls.target.set(0, 0.8, 0);
    if (v === 'top') {
      controls.target.set(0, 0, 0);
      camera.position.set(0, span * 1.3 + 1.5, 0.001);
    } else if (v === 'front') {
      controls.target.set(0, 1.0, 0);
      camera.position.set(0, 1.5, size.d / 2 + span * 0.7 + 0.6);
      if (camera.aspect < 1) camera.position.y = 2.2;
    } else camera.position.set(span * 0.5 + 0.4, span * 0.6 + 1.4, size.d / 2 + span * 0.55 + 0.6);
    camera.userData.placed = true;
    controls.update();
    render();
  }

  function select(id: string | null) {
    selected = id;
    highlight();
  }

  function setZones(on: boolean) {
    showZones = on;
    if (zones) zones.visible = on;
    render();
  }

  // Tap / click picking that ignores drags.
  const ray = new THREE.Raycaster();
  let downAt: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
  const onUp = (e: PointerEvent) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return;
    downAt = null;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects([...rackMeshes.values()], false)[0];
    const id = (hit?.object.userData.rackId as string) ?? null;
    select(id);
    onPick(id);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);

  function dispose() {
    ro.disconnect();
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    controls.dispose();
    disposeGroup(content);
    renderer.dispose();
  }

  resize();
  return { update, view, select, setZones, dispose };
}
