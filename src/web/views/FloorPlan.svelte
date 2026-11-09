<script lang="ts">
  import type { Floor, Room } from '../../core/model.ts';
  import { meta } from '../../core/model.ts';
  import { ITEM_DEFS, footprint, itemBox } from '../../core/plan.ts';
  import { rectFrom, roomBounds, rotateInPlace, round2, scaleFrom, type Pt } from '../../core/floorplan.ts';
  import { db, deletePhoto, save } from '../lib/db.ts';
  import { live } from '../lib/live.svelte.ts';
  import { fetchPhotoBlob, sha256Hex } from '../lib/sync.svelte.ts';
  import { toast } from '../lib/ui.svelte.ts';
  import { drawingKind, loadDrawing } from '../lib/drawing.ts';
  import Icon from '../lib/Icon.svelte';
  import Sheet from '../lib/Sheet.svelte';

  let { id }: { id: string } = $props();

  const data = live(
    () => id,
    async fid => {
      const floor = await db.floors.get(fid);
      if (!floor) return null;
      const rooms = await db.rooms.where('floorId').equals(fid).sortBy('name');
      const racks = await db.racks.where('roomId').anyOf(rooms.map(r => r.id)).toArray();
      const photo = floor.plan?.photoId ? await db.photos.get(floor.plan.photoId) : undefined;
      return { floor, rooms, racks, photo };
    }
  );
  const floor = $derived(data.value?.floor);
  const rooms = $derived(data.value?.rooms ?? []);
  const plan = $derived(floor?.plan);
  /** Until calibrated, assume 1 drawing pixel = 1 cm so the drawing still shows. */
  const mPerPx = $derived(plan?.mPerPx ?? 0.01);
  const scaled = $derived(!!plan?.mPerPx);

  // --- drawing image ---
  let url = $state('');
  $effect(() => {
    const p = data.value?.photo;
    if (!p) {
      url = '';
      return;
    }
    if (!p.blob) {
      fetchPhotoBlob(p);
      return;
    }
    const u = URL.createObjectURL(p.blob);
    url = u;
    return () => URL.revokeObjectURL(u);
  });
  const imgW = $derived((plan?.imgW ?? 0) * mPerPx);
  const imgH = $derived((plan?.imgH ?? 0) * mPerPx);

  // Floor extent in metres: the drawing, or the rooms, or a default site.
  const extent = $derived.by(() => {
    let w = imgW || 30;
    let h = imgH || 20;
    for (const r of rooms) {
      const b = roomBounds(r);
      if (b) {
        w = Math.max(w, b.x + b.w + 1);
        h = Math.max(h, b.y + b.h + 1);
      }
    }
    return { w, h };
  });

  // --- view: pan and zoom, in metres ---
  let svg: SVGSVGElement | undefined = $state();
  let box = $state({ w: 800, h: 500 });
  let view = $state({ x: 0, y: 0, w: 30 });
  const viewH = $derived(view.w * (box.h / box.w));
  let fitted = false;
  function fit() {
    const pad = 0.04;
    const w = Math.max(extent.w, extent.h * (box.w / box.h)) * (1 + 2 * pad);
    view = { x: (extent.w - w) / 2, y: (extent.h - w * (box.h / box.w)) / 2, w };
  }
  $effect(() => {
    if (!svg) return;
    const ro = new ResizeObserver(() => {
      const r = svg!.getBoundingClientRect();
      if (r.width && r.height) box = { w: r.width, h: r.height };
      if (!fitted && data.value) {
        fitted = true;
        fit();
      }
    });
    ro.observe(svg);
    return () => ro.disconnect();
  });
  $effect(() => {
    if (data.value && !fitted && box.w) {
      fitted = true;
      fit();
    }
  });
  const toFloorPt = (cx: number, cy: number): Pt => {
    const r = svg!.getBoundingClientRect();
    return { x: view.x + ((cx - r.left) / r.width) * view.w, y: view.y + ((cy - r.top) / r.height) * viewH };
  };
  function zoomAt(f: number, at?: Pt) {
    const c = at ?? { x: view.x + view.w / 2, y: view.y + viewH / 2 };
    const w = Math.min(Math.max(view.w * f, 0.5), Math.max(extent.w, extent.h) * 6);
    const k = w / view.w;
    view = { x: c.x - (c.x - view.x) * k, y: c.y - (c.y - view.y) * k, w };
  }
  function zoomTo(b: { x: number; y: number; w: number; h: number }) {
    const w = Math.max(b.w * 1.8, (b.h * 1.8 * box.w) / box.h, 4);
    view = { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - (w * box.h) / box.w / 2, w };
  }

  // Pointers: one finger / mouse pans, two fingers pinch, a short tap acts.
  const pts = new Map<number, { x: number; y: number }>();
  let start: { x: number; y: number; moved: boolean } | null = null;
  let pinch: { d: number; w: number; c: Pt } | null = null;
  function pdown(e: PointerEvent) {
    svg!.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) start = { x: e.clientX, y: e.clientY, moved: false };
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), w: view.w, c: toFloorPt((a.x + b.x) / 2, (a.y + b.y) / 2) };
      if (start) start.moved = true;
    }
  }
  function pmove(e: PointerEvent) {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const w = Math.min(Math.max((pinch.w * pinch.d) / Math.max(d, 1), 0.5), Math.max(extent.w, extent.h) * 6);
      const r = svg!.getBoundingClientRect();
      const mx = ((a.x + b.x) / 2 - r.left) / r.width;
      const my = ((a.y + b.y) / 2 - r.top) / r.height;
      view = { x: pinch.c.x - mx * w, y: pinch.c.y - my * w * (box.h / box.w), w };
      return;
    }
    if (!start) return;
    if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
    start.moved = true;
    const k = view.w / box.w;
    view = { ...view, x: view.x - (e.clientX - prev.x) * k, y: view.y - (e.clientY - prev.y) * k };
  }
  function pup(e: PointerEvent) {
    const wasTap = pts.size === 1 && start && !start.moved;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) {
      if (wasTap) tap(toFloorPt(e.clientX, e.clientY));
      start = null;
    }
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    zoomAt(Math.exp(e.deltaY * 0.0015), toFloorPt(e.clientX, e.clientY));
  }

  // --- modes: calibrate the scale, outline a room, place a sized room ---
  type Mode = { kind: 'idle' } | { kind: 'scale'; pts: Pt[] } | { kind: 'outline'; roomId: string | null; pts: Pt[] } | { kind: 'place'; roomId: string };
  let mode = $state<Mode>({ kind: 'idle' });
  let hover = $state<Pt | null>(null);
  let selId = $state('');
  const sel = $derived(rooms.find(r => r.id === selId));

  const hint = $derived(
    mode.kind === 'scale'
      ? mode.pts.length === 0
        ? 'Мащаб: докосни началото на позната дължина (стена, ос, кота).'
        : 'Мащаб: докосни края ѝ.'
      : mode.kind === 'outline'
        ? mode.pts.length === 0
          ? 'Очертай: докосни единия ъгъл на помещението.'
          : 'Очертай: докосни срещуположния ъгъл.'
        : mode.kind === 'place'
          ? 'Докосни къде е горният ляв ъгъл на помещението.'
          : ''
  );

  async function tap(p: Pt) {
    if (mode.kind === 'scale') {
      mode.pts.push(p);
      if (mode.pts.length === 2) {
        scaleLen = '';
        scaleOpen = true;
      }
      return;
    }
    if (mode.kind === 'outline') {
      mode.pts.push(p);
      if (mode.pts.length === 2) await finishOutline();
      return;
    }
    if (mode.kind === 'place') {
      const r = rooms.find(x => x.id === (mode as { roomId: string }).roomId);
      if (r) await saveRoom(r, { floor: { x: round2(p.x), y: round2(p.y), rot: 0 } });
      selId = r?.id ?? '';
      mode = { kind: 'idle' };
      return;
    }
    // Idle: select the room under the tap.
    const hit = rooms.find(r => {
      const b = roomBounds(r);
      return b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    });
    selId = hit?.id ?? '';
  }

  async function saveRoom(r: Room, patch: Partial<Room>) {
    await save('rooms', $state.snapshot({ ...r, ...patch }));
  }
  async function saveFloor(patch: Partial<Floor>) {
    if (floor) await save('floors', $state.snapshot({ ...floor, ...patch }));
  }

  // Scale
  let scaleOpen = $state(false);
  let scaleLen = $state('');
  async function applyScale(e: SubmitEvent) {
    e.preventDefault();
    if (mode.kind !== 'scale' || !plan) return;
    const metres = Number(String(scaleLen).replace(',', '.'));
    // Points are in metres at the current scale; back to drawing pixels first.
    const [a, b] = mode.pts.map(p => ({ x: p.x / mPerPx, y: p.y / mPerPx }));
    const next = scaleFrom(a, b, metres);
    if (!next) return toast('Въведи дължина в метри и избери две различни точки.');
    // Keep placed rooms on the same spot of the drawing.
    const k = next / mPerPx;
    for (const r of rooms) if (r.floor) await saveRoom(r, { floor: { ...r.floor, x: round2(r.floor.x * k), y: round2(r.floor.y * k) } });
    await saveFloor({ plan: { ...plan, mPerPx: next } });
    scaleOpen = false;
    mode = { kind: 'idle' };
    view = { x: view.x * k, y: view.y * k, w: view.w * k };
    toast(`Мащабът е зададен: 1 m = ${Math.round(1 / next)} px от чертежа.`);
  }

  // Outline → size + position of an existing room, or a new room.
  let newOpen = $state(false);
  let newName = $state('');
  let pending = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  async function finishOutline() {
    if (mode.kind !== 'outline') return;
    const r = rectFrom(mode.pts[0], mode.pts[1]);
    if (r.w < 0.5 || r.h < 0.5) {
      toast('Помещението е твърде малко — поне 0,5 × 0,5 m.');
      mode = { ...mode, pts: [] };
      return;
    }
    const rect = { x: round2(r.x), y: round2(r.y), w: round2(r.w), h: round2(r.h) };
    if (mode.roomId) {
      const room = rooms.find(x => x.id === (mode as { roomId: string }).roomId);
      if (room) {
        const same = room.widthM && room.depthM && Math.abs(room.widthM - rect.w) < 0.05 && Math.abs(room.depthM - rect.h) < 0.05;
        if (room.widthM && room.depthM && !same && !confirm(`Помещението е ${room.widthM} × ${room.depthM} m, а очертаното — ${rect.w} × ${rect.h} m. Да сменя ли размерите му?`)) {
          await saveRoom(room, { floor: { x: rect.x, y: rect.y, rot: 0 } });
        } else await saveRoom(room, { widthM: rect.w, depthM: rect.h, floor: { x: rect.x, y: rect.y, rot: 0 } });
        selId = room.id;
      }
      mode = { kind: 'idle' };
      return;
    }
    pending = rect;
    newName = '';
    newOpen = true;
  }
  async function createRoom(e: SubmitEvent) {
    e.preventDefault();
    if (!floor || !pending || !newName.trim()) return;
    const r: Room = { ...meta(), surveyId: floor.surveyId, floorId: floor.id, name: newName.trim(), widthM: pending.w, depthM: pending.h, floor: { x: pending.x, y: pending.y, rot: 0 } };
    await save('rooms', r);
    newOpen = false;
    pending = null;
    mode = { kind: 'idle' };
    selId = r.id;
  }
  function cancelMode() {
    mode = { kind: 'idle' };
    pending = null;
  }

  // Selected room: move, turn, remove from the floor.
  let step = $state(0.1);
  async function nudge(dx: number, dy: number) {
    if (sel?.floor) await saveRoom(sel, { floor: { ...sel.floor, x: round2(sel.floor.x + dx), y: round2(sel.floor.y + dy) } });
  }
  async function turn() {
    if (sel?.floor) await saveRoom(sel, { floor: rotateInPlace(sel) });
  }
  async function unplace() {
    if (!sel) return;
    const { floor: _f, ...rest } = $state.snapshot(sel);
    await save('rooms', rest);
    selId = '';
  }

  // --- drawing upload ---
  let fileInput: HTMLInputElement | undefined = $state();
  let busy = $state('');
  let pdfFile: File | null = null;
  let pagesOpen = $state(false);
  let pageCount = $state(1);
  let page = $state(1);
  async function pick(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!f) return;
    if (drawingKind(f) === 'pdf') pdfFile = f;
    await useDrawing(f, 1);
  }
  async function useDrawing(f: File, pg: number) {
    if (!floor) return;
    busy = 'Обработвам чертежа…';
    try {
      const d = await loadDrawing(f, pg);
      if (d.pages > 1 && !pagesOpen && pg === 1) {
        pageCount = d.pages;
        page = 1;
        pagesOpen = true;
      }
      const hash = await sha256Hex(d.blob);
      const photo = { ...meta(), surveyId: floor.surveyId, ownerKind: 'floor' as const, ownerId: floor.id, blob: d.blob, hash, mime: 'image/jpeg', width: d.width, height: d.height };
      await save('photos', photo);
      const old = plan?.photoId;
      // A new drawing of the same size keeps the scale; otherwise it must be set again.
      const keep = plan?.mPerPx && plan.imgW === d.width && plan.imgH === d.height;
      await saveFloor({ plan: { photoId: photo.id, imgW: d.width, imgH: d.height, source: f.name + (d.pages > 1 ? ` · стр. ${pg}` : ''), ...(keep ? { mPerPx: plan!.mPerPx } : {}) } });
      if (old) await deletePhoto(old);
      fitted = false;
      toast(keep ? 'Чертежът е сменен.' : 'Чертежът е качен. Сега задай мащаба.');
    } catch (err) {
      toast((err as Error).message || 'Чертежът не можа да се обработи.');
    } finally {
      busy = '';
    }
  }
  async function choosePage(e: SubmitEvent) {
    e.preventDefault();
    pagesOpen = false;
    if (pdfFile && page !== 1) await useDrawing(pdfFile, page);
  }
  async function removeDrawing() {
    if (!plan?.photoId || !confirm('Да махна ли чертежа? Помещенията остават на местата си.')) return;
    await deletePhoto(plan.photoId);
    const { plan: _p, ...rest } = $state.snapshot(floor!);
    await save('floors', rest);
  }

  // --- drawing helpers ---
  const racksIn = (roomId: string) => (data.value?.racks ?? []).filter(r => r.roomId === roomId && r.plan);
  const fmt = (v: number) => v.toFixed(2).replace('.', ',');
  const stroke = $derived(view.w / 400);
  const placedRooms = $derived(rooms.filter(r => r.floor && r.widthM && r.depthM));
  const unplacedRooms = $derived(rooms.filter(r => !(r.floor && r.widthM && r.depthM)));
  const draft = $derived(mode.kind === 'outline' && mode.pts.length === 1 && hover ? rectFrom(mode.pts[0], hover) : null);
  function phover(e: PointerEvent) {
    if (mode.kind !== 'idle' && e.pointerType === 'mouse') hover = toFloorPt(e.clientX, e.clientY);
    pmove(e);
  }
</script>

<header class="topbar">
  <div class="row">
    <a class="icon-btn" href={floor ? '#/s/' + floor.surveyId : '#/'} aria-label="Назад към огледа" style="margin-left: -10px"><Icon name="back" /></a>
  </div>
  {#if floor}
    <div>
      <div class="title">План на етажа · {floor.name}</div>
      <div class="sub">{placedRooms.length} от {rooms.length} помещения на етажа{plan?.photoId ? (scaled ? ` · 1 m = ${Math.round(1 / mPerPx)} px` : ' · без мащаб') : ' · без чертеж'}</div>
    </div>
  {/if}
</header>

{#if data.loaded && !floor}
  <main><div class="empty">Етажът не е намерен.</div></main>
{:else if floor}
  <main>
    <div class="floor-layout">
      <div class="floor-canvas">
        <svg
          bind:this={svg}
          viewBox={`${view.x} ${view.y} ${view.w} ${viewH}`}
          role="application"
          aria-label={`План на ${floor.name}`}
          onpointerdown={pdown}
          onpointermove={phover}
          onpointerup={pup}
          onpointercancel={pup}
          onwheel={wheel}
          class:picking={mode.kind !== 'idle'}
        >
          <defs>
            <pattern id="fgrid" width="1" height="1" patternUnits="userSpaceOnUse">
              <path d="M1 0 L0 0 0 1" fill="none" stroke="#E3E8E6" stroke-width={stroke / 2} />
            </pattern>
          </defs>
          <rect x={-1000} y={-1000} width={2000} height={2000} fill="#F7F9F8" />
          {#if url}
            <image href={url} x="0" y="0" width={imgW} height={imgH} preserveAspectRatio="none" opacity="0.92" />
          {:else}
            <rect x="0" y="0" width={extent.w} height={extent.h} fill="url(#fgrid)" />
          {/if}

          {#each placedRooms as r (r.id)}
            {@const f = r.floor!}
            {@const on = r.id === selId}
            <g transform={`translate(${f.x} ${f.y}) rotate(${f.rot})`}>
              <rect x="0" y="0" width={r.widthM} height={r.depthM} fill={on ? 'rgba(240,138,75,0.28)' : 'rgba(240,138,75,0.14)'} stroke={on ? '#C2410C' : '#E07A3E'} stroke-width={on ? stroke * 2.2 : stroke * 1.3} />
              {#each r.items ?? [] as it}
                {@const b = itemBox(it)}
                {#if b}<rect x={b.x} y={b.y} width={b.w} height={b.h} fill={ITEM_DEFS[it.kind].color} opacity="0.5" />
                {:else}<circle cx={it.x} cy={it.y} r={Math.min(0.12, stroke * 4)} fill={ITEM_DEFS[it.kind].color} />{/if}
              {/each}
              {#each racksIn(r.id) as k}
                {@const b = footprint(k)!}
                <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="#2B3A40" />
              {/each}
            </g>
          {/each}
          {#each placedRooms as r (r.id)}
            {@const b = roomBounds(r)!}
            {@const fs = Math.min(Math.max(stroke * 11, 0.18), b.w / 6)}
            <text x={b.x + b.w / 2} y={b.y - fs * 0.4} text-anchor="middle" font-size={fs} font-weight="700" fill="#9A3412" stroke="#fff" stroke-width={fs / 6} paint-order="stroke" font-family="IBM Plex Sans, sans-serif">{r.name}</text>
          {/each}

          {#if mode.kind === 'scale'}
            {#each mode.pts as p}<circle cx={p.x} cy={p.y} r={stroke * 5} fill="#2563EB" />{/each}
            {#if mode.pts.length === 2}<line x1={mode.pts[0].x} y1={mode.pts[0].y} x2={mode.pts[1].x} y2={mode.pts[1].y} stroke="#2563EB" stroke-width={stroke * 2} />{/if}
            {#if mode.pts.length === 1 && hover}<line x1={mode.pts[0].x} y1={mode.pts[0].y} x2={hover.x} y2={hover.y} stroke="#2563EB" stroke-width={stroke * 1.5} stroke-dasharray={`${stroke * 6} ${stroke * 4}`} />{/if}
          {/if}
          {#if mode.kind === 'outline'}
            {#each mode.pts as p}<circle cx={p.x} cy={p.y} r={stroke * 5} fill="#C2410C" />{/each}
            {#if draft}<rect x={draft.x} y={draft.y} width={draft.w} height={draft.h} fill="rgba(194,65,12,0.15)" stroke="#C2410C" stroke-width={stroke * 1.5} stroke-dasharray={`${stroke * 6} ${stroke * 4}`} />{/if}
          {/if}
        </svg>
        {#if hint}
          <div class="hint">{hint}<button class="btn small" onclick={cancelMode}>Откажи</button></div>
        {/if}
        <div class="zoom">
          <button class="btn small" aria-label="Приближи" onclick={() => zoomAt(0.7)}>+</button>
          <button class="btn small" aria-label="Отдалечи" onclick={() => zoomAt(1.4)}>−</button>
          <button class="btn small" aria-label="Целият етаж" onclick={fit}>⤢</button>
        </div>
        {#if busy}<div class="overlay">{busy}</div>{/if}
      </div>

      <aside class="floor-side">
        {#if sel}
          <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px">
              <h2 style="font-size: 18px">{sel.name}</h2>
              <a href={'#/room/' + sel.id + '/plan'} style="font-size: 14px; font-weight: 600; white-space: nowrap">План →</a>
            </div>
            <span class="muted">{sel.widthM && sel.depthM ? `${fmt(sel.widthM)} × ${fmt(sel.depthM)} m` : 'без размери'} · {racksIn(sel.id).length} шкафа на плана</span>
            {#if sel.floor}
              <div class="field">
                <span style="font-size: 13px; font-weight: 600; color: var(--muted)">Премести</span>
                <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap">
                  <div class="nudge">
                    <span></span><button class="btn small" aria-label="Нагоре" onclick={() => nudge(0, -step)}>↑</button><span></span>
                    <button class="btn small" aria-label="Наляво" onclick={() => nudge(-step, 0)}>←</button>
                    <button class="btn small" aria-label="Надолу" onclick={() => nudge(0, step)}>↓</button>
                    <button class="btn small" aria-label="Надясно" onclick={() => nudge(step, 0)}>→</button>
                  </div>
                  <div class="seg2" role="group" aria-label="Стъпка">
                    {#each [[0.1, '10 cm'], [1, '1 m']] as [v, l]}<button class="btn small" class:dark={step === v} onclick={() => (step = v as number)}>{l}</button>{/each}
                  </div>
                </div>
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap">
                <button class="btn small" onclick={turn}>↻ Завърти 90°</button>
                <button class="btn small" onclick={() => (mode = { kind: 'outline', roomId: sel.id, pts: [] })}>Очертай наново</button>
                <a class="btn small" href={'#/room/' + sel.id + '/3d'} style="text-decoration: none">3D</a>
                <button class="btn small danger" onclick={unplace}>Махни от етажа</button>
              </div>
            {/if}
          </div>
        {/if}

        <div class="card">
          <h3 style="font-size: 15px">Чертеж</h3>
          {#if plan?.photoId}
            <span class="muted" style="font-size: 14px">{plan.source ?? 'чертеж'} · {plan.imgW} × {plan.imgH} px</span>
            {#if !scaled}<p style="margin: 0; color: var(--accent-ink); font-size: 14px">⚠ Мащабът не е зададен — размерите на помещенията няма да съвпадат с чертежа.</p>{/if}
            <div style="display: flex; gap: 8px; flex-wrap: wrap">
              <button class="btn small" class:dark={!scaled} onclick={() => { mode = { kind: 'scale', pts: [] }; selId = ''; }}>{scaled ? 'Мащаб отново' : 'Задай мащаб'}</button>
              <button class="btn small" onclick={() => fileInput?.click()}>Смени чертежа</button>
              <button class="btn small danger" onclick={removeDrawing}>Махни</button>
            </div>
          {:else}
            <p class="muted" style="margin: 0">PDF или снимка на етажа. DWG първо се записва като PDF. Може и без чертеж — тогава подреждаш помещенията върху мрежа през 1 m.</p>
            <button class="btn small dark" style="align-self: flex-start" onclick={() => fileInput?.click()}>Качи чертеж</button>
          {/if}
          <input bind:this={fileInput} type="file" accept=".pdf,application/pdf,image/*,.dwg,.dxf" hidden onchange={pick} />
        </div>

        <div class="section-title">
          Помещения на етажа
          <button class="btn small" onclick={() => { mode = { kind: 'outline', roomId: null, pts: [] }; selId = ''; }}><Icon name="plus" size={16} /> Очертай ново</button>
        </div>
        <div class="list">
          {#each placedRooms as r (r.id)}
            <button class="row-btn" class:on={r.id === selId} onclick={() => { selId = r.id; zoomTo(roomBounds(r)!); }}>
              <span><b>{r.name}</b><br /><span class="muted">{fmt(r.widthM!)} × {fmt(r.depthM!)} m · {racksIn(r.id).length} шкафа</span></span>
              <span class="muted">на етажа</span>
            </button>
          {/each}
          {#each unplacedRooms as r (r.id)}
            <div>
              <span><b>{r.name}</b><br /><span class="muted">{r.widthM && r.depthM ? `${fmt(r.widthM)} × ${fmt(r.depthM)} m` : 'без размери'}</span></span>
              <span style="display: flex; gap: 6px">
                {#if r.widthM && r.depthM}<button class="btn small" onclick={() => { mode = { kind: 'place', roomId: r.id }; selId = ''; }}>Сложи</button>{/if}
                <button class="btn small" onclick={() => { mode = { kind: 'outline', roomId: r.id, pts: [] }; selId = ''; }}>Очертай</button>
              </span>
            </div>
          {/each}
          {#if !rooms.length}<div class="muted">На този етаж още няма помещения — очертай първото върху чертежа.</div>{/if}
        </div>
      </aside>
    </div>
  </main>

  <Sheet bind:open={scaleOpen} title="Мащаб">
    <form class="stack" onsubmit={applyScale}>
      <div class="field"><label for="sl">Колко метра е отсечката?</label><input id="sl" class="mono" inputmode="decimal" bind:value={scaleLen} placeholder="напр. 6,00" required /></div>
      <p class="muted" style="margin: 0">Колкото по-дълга е отсечката (цяла стена, разстояние между оси), толкова по-точен е мащабът.</p>
      <button class="btn primary block" type="submit">Запази мащаба</button>
    </form>
  </Sheet>

  <Sheet bind:open={newOpen} title="Ново помещение">
    <form class="stack" onsubmit={createRoom}>
      <div class="field"><label for="nn">Име</label><input id="nn" bind:value={newName} placeholder="напр. Сървърно 1.04" required /></div>
      {#if pending}<p class="muted" style="margin: 0">{fmt(pending.w)} × {fmt(pending.h)} m — размерите влизат и в плана на помещението.</p>{/if}
      <button class="btn primary block" type="submit">Създай</button>
    </form>
  </Sheet>

  <Sheet bind:open={pagesOpen} title="Коя страница?">
    <form class="stack" onsubmit={choosePage}>
      <div class="field"><label for="pg">Страница (1–{pageCount})</label><input id="pg" type="number" min="1" max={pageCount} bind:value={page} /></div>
      <p class="muted" style="margin: 0">PDF-ът има {pageCount} страници. Показана е първата.</p>
      <button class="btn primary block" type="submit">Използвай тази страница</button>
    </form>
  </Sheet>
{/if}

<style>
  .floor-layout { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
  .floor-canvas { position: relative; flex: 999 1 460px; min-width: 0; border-radius: var(--radius); overflow: hidden; border: 1px solid var(--line-2); background: #f7f9f8; }
  .floor-canvas svg { display: block; width: 100%; height: min(70dvh, 680px); touch-action: none; cursor: grab; user-select: none; }
  .floor-canvas svg.picking { cursor: crosshair; }
  .floor-side { flex: 1 1 300px; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
  .hint { position: absolute; left: 8px; right: 8px; top: 8px; background: rgba(19, 35, 43, 0.92); color: #fff; border-radius: 10px; padding: 8px 8px 8px 12px; display: flex; gap: 10px; align-items: center; justify-content: space-between; font-size: 14px; }
  .hint .btn { background: #fff; color: var(--ink); flex: none; }
  .zoom { position: absolute; right: 8px; bottom: 8px; display: flex; flex-direction: column; gap: 6px; }
  .zoom .btn { width: 44px; padding: 0; font-size: 20px; background: #fff; }
  .overlay { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(247, 249, 248, 0.85); font-weight: 600; }
  .nudge { display: grid; grid-template-columns: repeat(3, 52px); gap: 6px; }
  .nudge .btn { height: 42px; font-size: 18px; }
  .seg2 { display: flex; gap: 6px; }
  .row-btn { display: flex; justify-content: space-between; align-items: center; width: 100%; background: none; border: 0; border-bottom: 1px solid var(--line-2); text-align: left; cursor: pointer; }
  .row-btn.on { background: #fff4ec; }
</style>
