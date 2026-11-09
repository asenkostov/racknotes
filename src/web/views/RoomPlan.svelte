<script lang="ts">
  import type { Door, Facing, ItemKind, Rack, RackDoor, RoomItem, Wall } from '../../core/model.ts';
  import { meta } from '../../core/model.ts';
  import { DEFAULT_RACK_MM, ITEM_DEFS, blocksFloor, checkItems, checkPlan, clampInto, doorLabel, firstFreeSpot, footprint, itemBox, itemName, itemSize, rackSwings, round, swingPoints, tidy, type Box } from '../../core/plan.ts';
  import { usedUnits } from '../../core/rack.ts';
  import { db, discardPhotos, save } from '../lib/db.ts';
  import { live } from '../lib/live.svelte.ts';
  import { toast } from '../lib/ui.svelte.ts';
  import Icon from '../lib/Icon.svelte';
  import Sheet from '../lib/Sheet.svelte';
  import ItemPanel from '../lib/ItemPanel.svelte';

  let { id }: { id: string } = $props();

  const data = live(
    () => id,
    async rid => {
      const room = await db.rooms.get(rid);
      if (!room) return null;
      const racks = await db.racks.where('roomId').equals(rid).sortBy('name');
      const devices = await db.devices.where('rackId').anyOf(racks.map(r => r.id)).toArray();
      return { room, racks, devices };
    }
  );
  const room = $derived(data.value?.room);
  const hasSize = $derived(!!room?.widthM && !!room?.depthM);
  const dims = $derived({ widthM: room?.widthM ?? 0, depthM: room?.depthM ?? 0 });

  // While dragging, the moved rack's position lives here and is saved on release.
  let dragPos = $state<{ id: string; x: number; y: number } | null>(null);
  const racks = $derived(
    (data.value?.racks ?? []).map(r => (dragPos && dragPos.id === r.id && r.plan ? { ...r, plan: { ...r.plan, x: dragPos.x, y: dragPos.y } } : r))
  );
  const placed = $derived(racks.filter(r => r.plan).map(r => ({ r, b: footprint(r)! })));
  const unplaced = $derived(racks.filter(r => !r.plan));
  const items = $derived((room?.items ?? []).map(i => (dragPos && dragPos.id === i.id ? { ...i, x: dragPos.x, y: dragPos.y } : i)));
  const roomNow = $derived(room ? { ...room, items } : undefined);
  const issues = $derived(roomNow ? [...checkPlan(roomNow, racks), ...checkItems(roomNow, racks)] : []);
  const bad = $derived(new Set(issues.filter(i => i.level !== 'ok').map(i => i.rackId ?? i.itemId)));

  // One selection for racks and room items (ids never clash).
  let selId = $state('');
  const sel = $derived(racks.find(r => r.id === selId && r.plan));
  const selItem = $derived(items.find(i => i.id === selId));

  // --- drawing scale: SVG units are centimetres ---
  const W = $derived(dims.widthM * 100);
  const D = $derived(dims.depthM * 100);
  const M = 70;
  const f = $derived(Math.max(W, D) / 42);

  async function saveRack(r: Rack, patch: Partial<Rack>) {
    await save('racks', $state.snapshot({ ...r, ...patch }));
  }

  /** Save the room with a patch; snapshot everything so IndexedDB never sees reactive proxies. */
  async function saveRoom(patch: Partial<NonNullable<typeof room>>) {
    const r = data.value?.room;
    if (r) await save('rooms', $state.snapshot({ ...r, ...patch }));
  }

  // --- room items ---
  const boxOf = (i: RoomItem): Box => itemBox(i) ?? { x: i.x, y: i.y, w: 0, h: 0 };
  async function saveItem(itemId: string, patch: Partial<RoomItem>) {
    const r = data.value?.room;
    if (!r) return;
    const list = (r.items ?? []).map(i => {
      if (i.id !== itemId) return i;
      const next = { ...i, ...patch };
      for (const k of Object.keys(patch) as (keyof RoomItem)[]) if (patch[k] === undefined) delete next[k];
      return { ...next, ...clampInto(boxOf(next), dims) };
    });
    await saveRoom({ items: list });
  }
  async function nudgeItem(dx: number, dy: number) {
    const i = data.value?.room.items?.find(x => x.id === selId);
    if (i) await saveItem(i.id, { x: tidy(i.x + dx), y: tidy(i.y + dy) });
  }
  async function deleteItem() {
    const r = data.value?.room;
    if (!r || !confirm('Да изтрия ли обекта и снимките му?')) return;
    await discardPhotos('item', selId);
    await saveRoom({ items: (r.items ?? []).filter(i => i.id !== selId) });
    selId = '';
  }

  let itemOpen = $state(false);
  let newKind = $state<ItemKind>('panel');
  async function addItem(e: SubmitEvent) {
    e.preventDefault();
    const r = data.value?.room;
    if (!r) return;
    const def = ITEM_DEFS[newKind];
    const base: RoomItem = { id: crypto.randomUUID(), kind: newKind, x: tidy(dims.widthM / 2), y: tidy(dims.depthM / 2) };
    if (def.shape === 'point') {
      // Don't drop new markers on top of each other: walk out from the centre in 0.3 m steps.
      const pts = items.filter(i => ITEM_DEFS[i.kind].shape === 'point');
      const free = (x: number, y: number) => pts.every(p => Math.hypot(p.x - x, p.y - y) > 0.25);
      search: for (let ring = 0; ring < 12; ring++)
        for (let dx = -ring; dx <= ring; dx++)
          for (let dy = -ring; dy <= ring; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            const x = tidy(dims.widthM / 2 + dx * 0.3), y = tidy(dims.depthM / 2 + dy * 0.3);
            if (x >= 0 && y >= 0 && x <= dims.widthM && y <= dims.depthM && free(x, y)) {
              Object.assign(base, { x, y });
              break search;
            }
          }
    } else {
      const { w, d } = itemSize(base);
      const taken = [...placed.map(p => p.b), ...items.filter(blocksFloor).map(boxOf)];
      const spot = firstFreeSpot(dims, { widthMm: w * 1000, depthMm: d * 1000 }, taken);
      // Panels and wall units start on the top wall; the rest where there is floor space.
      Object.assign(base, newKind === 'panel' || newKind === 'ac' ? { x: spot.x, y: 0, facing: 'down' } : spot);
      if (newKind === 'column') delete base.facing;
    }
    await saveRoom({ items: [...(r.items ?? []), base] });
    itemOpen = false;
    selId = base.id;
  }

  // --- dragging with mouse or pen; touch only selects (nudge buttons instead) ---
  let svg: SVGSVGElement | undefined = $state();
  let drag: { id: string; dx: number; dy: number; box: Box; moved: boolean } | null = null;
  const toPlan = (e: PointerEvent) => {
    const p = svg!.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(svg!.getScreenCTM()!.inverse());
    return { x: q.x / 100, y: q.y / 100 };
  };
  function down(e: PointerEvent, r: { id: string }, b: Box) {
    selId = r.id;
    if (e.pointerType === 'touch') return;
    const p = toPlan(e);
    drag = { id: r.id, dx: p.x - b.x, dy: p.y - b.y, box: b, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const p = toPlan(e);
    const pos = clampInto({ ...drag.box, x: round(p.x - drag.dx), y: round(p.y - drag.dy) }, dims);
    drag.moved = true;
    dragPos = { id: drag.id, ...pos };
  }
  async function up() {
    const d = drag;
    drag = null;
    if (!d || !d.moved || !dragPos) return (dragPos = null);
    const r = data.value?.racks.find(x => x.id === d.id);
    const pos = dragPos;
    if (r?.plan) await saveRack(r, { plan: { ...r.plan, x: pos.x, y: pos.y } });
    else await saveItem(d.id, { x: pos.x, y: pos.y });
    dragPos = null;
  }

  async function nudge(dx: number, dy: number) {
    const r = data.value?.racks.find(x => x.id === selId);
    const b = r && footprint(r);
    if (!r?.plan || !b) return;
    const pos = clampInto({ ...b, x: tidy(b.x + dx), y: tidy(b.y + dy) }, dims);
    await saveRack(r, { plan: { ...r.plan, ...pos } });
  }
  async function face(facing: Facing) {
    const r = data.value?.racks.find(x => x.id === selId);
    if (!r?.plan) return;
    const b = footprint({ ...r, plan: { ...r.plan, facing } })!;
    await saveRack(r, { plan: { facing, ...clampInto(b, dims) } });
  }
  async function setNum(field: 'x' | 'y' | 'widthMm' | 'depthMm', value: string) {
    const r = data.value?.racks.find(x => x.id === selId);
    const v = Number(String(value).replace(',', '.'));
    if (!r?.plan || !Number.isFinite(v) || v < 0) return;
    if (field === 'x' || field === 'y') {
      const b = footprint(r)!;
      const pos = clampInto({ ...b, [field]: v }, dims);
      await saveRack(r, { plan: { ...r.plan, ...pos } });
    } else {
      if (v < 300 || v > 2000) return toast('Размерът трябва да е между 300 и 2000 mm.');
      await saveRack(r, { [field]: Math.round(v) });
    }
  }
  async function setDoor(side: 'front' | 'rear', value: string) {
    const r = data.value?.racks.find(x => x.id === selId);
    if (!r) return;
    const doors = { ...(r.doors ?? {}) };
    if (value) doors[side] = value as RackDoor;
    else delete doors[side];
    await saveRack(r, { doors });
  }
  const fan = (pts: { x: number; y: number }[]) => 'M' + pts.map(p => `${(p.x * 100).toFixed(1)} ${(p.y * 100).toFixed(1)}`).join(' L') + ' Z';

  async function place(r: Rack) {
    const spot = firstFreeSpot(dims, r, [...placed.map(p => p.b), ...items.filter(blocksFloor).map(boxOf)]);
    await saveRack(r, { plan: spot });
    selId = r.id;
  }
  async function unplace() {
    const r = data.value?.racks.find(x => x.id === selId);
    if (!r) return;
    const { plan: _drop, ...rest } = $state.snapshot(r);
    await save('racks', rest);
    selId = '';
  }

  // --- new rack, created straight onto the plan ---
  let rackOpen = $state(false);
  let rackForm = $state({ name: '', uHeight: 42, widthMm: DEFAULT_RACK_MM.width, depthMm: DEFAULT_RACK_MM.depth });
  function openRack() {
    rackForm = { name: `R${String(racks.length + 1).padStart(2, '0')}`, uHeight: 42, widthMm: DEFAULT_RACK_MM.width, depthMm: DEFAULT_RACK_MM.depth };
    rackOpen = true;
  }
  async function addRack(e: SubmitEvent) {
    e.preventDefault();
    if (!room || !rackForm.name.trim()) return;
    const uHeight = Math.trunc(Number(rackForm.uHeight));
    const widthMm = Math.round(Number(rackForm.widthMm));
    const depthMm = Math.round(Number(rackForm.depthMm));
    if (!(uHeight >= 1 && uHeight <= 60)) return toast('Височината трябва да е между 1 и 60 U.');
    if (!(widthMm >= 300 && widthMm <= 2000 && depthMm >= 300 && depthMm <= 2000)) return toast('Размерът трябва да е между 300 и 2000 mm.');
    const plan = firstFreeSpot(dims, { widthMm, depthMm }, [...placed.map(p => p.b), ...items.filter(blocksFloor).map(boxOf)]);
    const rack: Rack = { ...meta(), surveyId: room.surveyId, roomId: room.id, name: rackForm.name.trim(), uHeight, notes: '', widthMm, depthMm, plan };
    await save('racks', rack);
    rackOpen = false;
    selId = rack.id;
  }

  // --- room size and doors ---
  let sizeOpen = $state(false);
  let size = $state({ w: 0, d: 0 });
  function openSize() {
    size = { w: room?.widthM ?? 4, d: room?.depthM ?? 3 };
    sizeOpen = true;
  }
  async function saveSize(e: SubmitEvent) {
    e.preventDefault();
    const w = Number(String(size.w).replace(',', '.'));
    const d = Number(String(size.d).replace(',', '.'));
    if (!(w >= 1 && w <= 100 && d >= 1 && d <= 100)) return toast('Размерите трябва да са между 1 и 100 m.');
    await saveRoom({ widthM: tidy(w), depthM: tidy(d) });
    sizeOpen = false;
  }

  let doorOpen = $state(false);
  let door = $state<Door>({ wall: 'bottom', offset: 0.5, width: 0.9 });
  const wallLabel: Record<Wall, string> = { top: 'горна', right: 'дясна', bottom: 'долна', left: 'лява' };
  async function addDoor(e: SubmitEvent) {
    e.preventDefault();
    const len = door.wall === 'top' || door.wall === 'bottom' ? dims.widthM : dims.depthM;
    const off = Number(String(door.offset).replace(',', '.'));
    const wd = Number(String(door.width).replace(',', '.'));
    if (!(wd >= 0.5 && wd <= 3) || !(off >= 0) || off + wd > len + 1e-9) return toast(`Вратата не се побира в стената (${len.toFixed(2)} m).`);
    await saveRoom({ doors: [...(room!.doors ?? []), { wall: door.wall, offset: tidy(off), width: tidy(wd) }] });
    doorOpen = false;
  }
  async function removeDoor(i: number) {
    await saveRoom({ doors: (room!.doors ?? []).filter((_, j) => j !== i) });
  }

  // Door drawing: opening on the wall + swing arc into the room.
  function doorGeo(d: Door) {
    const a = d.offset * 100;
    const w = d.width * 100;
    switch (d.wall) {
      case 'top':
        return { gap: `M${a} 0 L${a + w} 0`, arc: `M${a} 0 L${a} ${w} A${w} ${w} 0 0 0 ${a + w} 0` };
      case 'bottom':
        return { gap: `M${a} ${D} L${a + w} ${D}`, arc: `M${a} ${D} L${a} ${D - w} A${w} ${w} 0 0 1 ${a + w} ${D}` };
      case 'left':
        return { gap: `M0 ${a} L0 ${a + w}`, arc: `M0 ${a} L${w} ${a} A${w} ${w} 0 0 1 0 ${a + w}` };
      case 'right':
        return { gap: `M${W} ${a} L${W} ${a + w}`, arc: `M${W} ${a} L${W - w} ${a} A${w} ${w} 0 0 0 ${W} ${a + w}` };
    }
  }
  // Front edge of a rack, drawn as a thick line.
  function frontEdge(b: Box, facing: Facing) {
    const x1 = b.x * 100, y1 = b.y * 100, x2 = (b.x + b.w) * 100, y2 = (b.y + b.h) * 100;
    return { up: [x1, y1, x2, y1], down: [x1, y2, x2, y2], left: [x1, y1, x1, y2], right: [x2, y1, x2, y2] }[facing];
  }
  const m = (v: number) => v.toFixed(2).replace('.', ',');
</script>

<header class="topbar">
  <div class="row">
    <a class="icon-btn" href={'#/room/' + id} aria-label="Назад към помещението" style="margin-left: -10px"><Icon name="back" /></a>
    {#if room}
      <div style="display: flex; gap: 8px">
        {#if hasSize}<a class="btn small" style="background: transparent; color: #fff; border-color: #4e6570; text-decoration: none" href={'#/room/' + id + '/3d'}>3D</a>{/if}
        <button class="btn small" style="background: transparent; color: #fff; border-color: #4e6570" onclick={openSize}>Размери</button>
      </div>
    {/if}
  </div>
  {#if room}
    <div>
      <div class="title">План · {room.name}</div>
      <div class="sub">{hasSize ? `${m(dims.widthM)} × ${m(dims.depthM)} m` : 'без размери'} · {placed.length} от {racks.length} шкафа на плана{items.length ? ` · ${items.length} ${items.length === 1 ? 'обект' : 'обекта'}` : ''}</div>
    </div>
  {/if}
</header>

{#if data.loaded && !room}
  <main><div class="empty">Помещението не е намерено.</div></main>
{:else if room}
  <main>
    {#if !hasSize}
      <div class="card">
        <h2 style="font-size: 17px">Първо — размерите на помещението</h2>
        <p class="muted" style="margin: 0">Вътрешни размери в метри. Шкафовете се разполагат спрямо тях.</p>
        <button class="btn primary" onclick={openSize}>Задай размери</button>
      </div>
    {:else}
      <div class="plan-layout">
        <div class="plan-canvas">
          <svg
            bind:this={svg}
            viewBox={`${-M} ${-M} ${W + 2 * M} ${D + 2 * M}`}
            role="img"
            aria-label={`План на ${room.name}`}
            onpointermove={move}
            onpointerup={up}
            onpointercancel={up}
            style="touch-action: none"
          >
            <defs>
              <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                <path d="M50 0 L0 0 0 50" fill="none" stroke="#E3E8E6" stroke-width={f / 12} />
              </pattern>
            </defs>
            <rect x="0" y="0" width={W} height={D} fill="url(#grid)" />
            <rect x="0" y="0" width={W} height={D} fill="none" stroke="#13232B" stroke-width={f / 2.2} />
            <text x={W / 2} y={-f * 1.1} text-anchor="middle" font-size={f} fill="#4A5B62" font-family="IBM Plex Mono, monospace">{m(dims.widthM)} m</text>
            <text x={-f * 0.8} y={D / 2} text-anchor="end" dominant-baseline="central" font-size={f} fill="#4A5B62" font-family="IBM Plex Mono, monospace">{m(dims.depthM)}</text>

            {#each room.doors ?? [] as d}
              {@const g = doorGeo(d)}
              <path d={g.gap} stroke="#FFFFFF" stroke-width={f / 1.6} />
              <path d={g.arc} fill="none" stroke="#8A979C" stroke-width={f / 10} stroke-dasharray={`${f / 3} ${f / 4}`} />
            {/each}

            {#each placed as { r } (r.id)}
              {#each rackSwings(r) as sw}
                {@const pts = swingPoints(sw)}
                <path d={fan(pts)} fill="rgba(124,58,237,0.10)" stroke="#7C3AED" stroke-width={f / 12} stroke-dasharray={`${f / 3} ${f / 4}`} />
                <line x1={pts[0].x * 100} y1={pts[0].y * 100} x2={pts.at(-1)!.x * 100} y2={pts.at(-1)!.y * 100} stroke="#7C3AED" stroke-width={f / 6} />
              {/each}
            {/each}
            {#each placed as { r, b } (r.id)}
              {@const e = frontEdge(b, r.plan!.facing)}
              {@const on = r.id === selId}
              <g
                class="plan-rack"
                role="button"
                tabindex="0"
                aria-label={r.name}
                onpointerdown={ev => down(ev, r, b)}
                onkeydown={ev => (ev.key === 'Enter' || ev.key === ' ') && (selId = r.id)}
              >
                <rect x={b.x * 100} y={b.y * 100} width={b.w * 100} height={b.h * 100} rx={f / 6}
                  fill={on ? '#13232B' : '#2B3A40'} stroke={bad.has(r.id) ? '#C2410C' : on ? '#F08A4B' : '#13232B'} stroke-width={on || bad.has(r.id) ? f / 4 : f / 12} />
                <line x1={e[0]} y1={e[1]} x2={e[2]} y2={e[3]} stroke="#3B82F6" stroke-width={f / 2.5} stroke-linecap="round" />
                <text x={(b.x + b.w / 2) * 100} y={(b.y + b.h / 2) * 100} text-anchor="middle" dominant-baseline="central" font-size={Math.min(f * 0.8, (b.w * 100) / 6)} fill="#FFFFFF" font-family="IBM Plex Mono, monospace" font-weight="600">{r.name}</text>
              </g>
            {/each}
            {#each items as it (it.id)}
              {@const def = ITEM_DEFS[it.kind]}
              {@const b = itemBox(it)}
              {@const on = it.id === selId}
              <g class="plan-rack" role="button" tabindex="0" aria-label={itemName(it)} onpointerdown={ev => down(ev, it, boxOf(it))} onkeydown={ev => (ev.key === 'Enter' || ev.key === ' ') && (selId = it.id)}>
                {#if b}
                  <rect x={b.x * 100} y={b.y * 100} width={b.w * 100} height={b.h * 100} rx={f / 8}
                    fill={it.kind === 'column' ? '#A8A29E' : def.color + '26'} stroke={bad.has(it.id) ? '#C2410C' : on ? '#F08A4B' : def.color}
                    stroke-width={on || bad.has(it.id) ? f / 4 : f / 8} stroke-dasharray={blocksFloor(it) ? undefined : `${f / 2.5} ${f / 4}`} />
                  {#if def.front}
                    {@const e = frontEdge(b, it.facing ?? 'down')}
                    <line x1={e[0]} y1={e[1]} x2={e[2]} y2={e[3]} stroke={def.color} stroke-width={f / 3} stroke-linecap="round" />
                  {/if}
                  {#if def.sym}<text x={(b.x + b.w / 2) * 100} y={(b.y + b.h / 2) * 100} text-anchor="middle" dominant-baseline="central" font-size={Math.min(f * 0.75, Math.max(b.w, b.h) * 100 / 3.2)} fill={def.color} font-family="IBM Plex Mono, monospace" font-weight="700">{def.sym}</text>{/if}
                {:else}
                  <circle cx={it.x * 100} cy={it.y * 100} r={f * 0.85} fill={def.color} stroke={bad.has(it.id) ? '#C2410C' : on ? '#F08A4B' : '#fff'} stroke-width={on ? f / 3.5 : f / 8} />
                  <text x={it.x * 100} y={it.y * 100} text-anchor="middle" dominant-baseline="central" font-size={f * (def.sym.length > 1 ? 0.6 : 0.85)} fill="#fff" font-family="IBM Plex Mono, monospace" font-weight="700">{def.sym}</text>
                {/if}
              </g>
            {/each}
          </svg>
          <div class="legend" style="margin-top: 6px">
            <span><i style="background: #3B82F6"></i>Лице на шкафа</span>
            <span><i style="border: 1px dashed #8A979C"></i>Врата</span>
            <span><i style="background: rgba(124,58,237,.25); border: 1px dashed #7C3AED"></i>Врата на шкаф</span>
            <span><i style="border: 1px dashed #0369A1"></i>Монтирано на стена</span>
            <span><i style="border: 2px solid #C2410C"></i>Има забележка</span>
          </div>
          <p class="muted hint-mouse" style="margin: 0">Влачи шкаф или обект с мишката; позициите се прилепват през 10 cm.</p>
          <p class="muted hint-touch" style="margin: 0">Докосни шкаф или обект, за да го избереш, после го мести със стрелките отдолу.</p>
        </div>

        <aside class="plan-side">
          {#if sel}
            {@const b = footprint(sel)!}
            <div class="card">
              <div style="display: flex; justify-content: space-between; align-items: baseline">
                <h2 style="font-size: 18px; font-family: var(--mono)">{sel.name}</h2>
                <a href={'#/r/' + sel.id} style="font-size: 14px; font-weight: 600">По U →</a>
              </div>
              <span class="muted">{sel.uHeight}U · {usedUnits(sel.uHeight, data.value?.devices.filter(d => d.rackId === sel.id) ?? [])} заети</span>
              <div class="grid2">
                <div class="field"><label for="pw">Ширина (mm)</label><input id="pw" class="mono" inputmode="numeric" value={sel.widthMm ?? DEFAULT_RACK_MM.width} onchange={e => setNum('widthMm', (e.target as HTMLInputElement).value)} /></div>
                <div class="field"><label for="pd">Дълбочина (mm)</label><input id="pd" class="mono" inputmode="numeric" value={sel.depthMm ?? DEFAULT_RACK_MM.depth} onchange={e => setNum('depthMm', (e.target as HTMLInputElement).value)} /></div>
                <div class="field"><label for="px">От лявата стена (m)</label><input id="px" class="mono" inputmode="decimal" value={m(b.x)} onchange={e => setNum('x', (e.target as HTMLInputElement).value)} /></div>
                <div class="field"><label for="py">От горната стена (m)</label><input id="py" class="mono" inputmode="decimal" value={m(b.y)} onchange={e => setNum('y', (e.target as HTMLInputElement).value)} /></div>
              </div>
              <div class="field">
                <span style="font-size: 13px; font-weight: 600; color: var(--muted)">Лицето гледа към</span>
                <div class="seg4" role="group" aria-label="Посока на лицето">
                  {#each [['up', '↑ горе'], ['right', '→ дясно'], ['down', '↓ долу'], ['left', '← ляво']] as [k, label]}
                    <button class="btn small" class:dark={sel.plan?.facing === k} aria-pressed={sel.plan?.facing === k} onclick={() => face(k as Facing)}>{label}</button>
                  {/each}
                </div>
              </div>
              <div class="grid2">
                {#each [['front', 'Врата отпред'], ['rear', 'Врата отзад']] as [side, l]}
                  <div class="field">
                    <label for={'door-' + side}>{l}</label>
                    <select id={'door-' + side} value={sel.doors?.[side as 'front' | 'rear'] ?? ''} onchange={e => setDoor(side as 'front' | 'rear', (e.target as HTMLSelectElement).value)}>
                      <option value="">не е отбелязано</option>
                      {#each Object.entries(doorLabel) as [k, v]}<option value={k}>{v}</option>{/each}
                    </select>
                  </div>
                {/each}
              </div>
              <p class="muted" style="margin: -4px 0 0; font-size: 13px">Пантите се гледат застанал срещу съответната страна на шкафа.</p>
              <div class="field">
                <span style="font-size: 13px; font-weight: 600; color: var(--muted)">Премести с 10 cm</span>
                <div class="nudge">
                  <span></span><button class="btn small" aria-label="Нагоре" onclick={() => nudge(0, -0.1)}>↑</button><span></span>
                  <button class="btn small" aria-label="Наляво" onclick={() => nudge(-0.1, 0)}>←</button>
                  <button class="btn small" aria-label="Надолу" onclick={() => nudge(0, 0.1)}>↓</button>
                  <button class="btn small" aria-label="Надясно" onclick={() => nudge(0.1, 0)}>→</button>
                </div>
              </div>
              <button class="btn small danger" style="align-self: flex-start" onclick={unplace}>Махни от плана</button>
            </div>
          {:else if selItem && room}
            {#key selItem.id}
              <ItemPanel item={selItem} surveyId={room.surveyId} onchange={patch => saveItem(selItem.id, patch)} onnudge={nudgeItem} ondelete={deleteItem} />
            {/key}
          {:else if placed.length || items.length}
            <div class="card"><p class="muted" style="margin: 0">Избери шкаф или обект от плана, за да го местиш, завъртиш или да смениш размера му.</p></div>
          {/if}

          <button class="btn primary block" onclick={openRack}><Icon name="plus" size={18} /> Нов шкаф на плана</button>
          {#if !racks.length}
            <div class="card"><p class="muted" style="margin: 0">В помещението още няма шкафове. Добави шкаф и после го премести с бутоните или с числа.</p></div>
          {/if}
          {#if unplaced.length}
            <div class="section-title">Не са на плана</div>
            <div class="list">
              {#each unplaced as r (r.id)}
                <div><b class="mono">{r.name}</b><button class="btn small" onclick={() => place(r)}>Сложи на плана</button></div>
              {/each}
            </div>
          {/if}

          <div class="section-title">
            Обекти в помещението
            <button class="btn small" onclick={() => (itemOpen = true)}><Icon name="plus" size={16} /> Обект</button>
          </div>
          {#if items.length}
            <div class="list">
              {#each items as it (it.id)}
                <button class="item-row" class:on={it.id === selId} onclick={() => (selId = it.id)}>
                  <span class="dot" style="background: {ITEM_DEFS[it.kind].color}"></span>
                  <span style="flex: 1; text-align: left">{itemName(it)}</span>
                  {#if it.notes}<span class="muted" style="font-size: 13px">бележка</span>{/if}
                </button>
              {/each}
            </div>
          {/if}

          <div class="section-title">
            Врати
            <button class="btn small" onclick={() => { door = { wall: 'bottom', offset: 0.5, width: 0.9 }; doorOpen = true; }}><Icon name="plus" size={16} /> Врата</button>
          </div>
          {#if room.doors?.length}
            <div class="list">
              {#each room.doors as d, i}
                <div><span>{wallLabel[d.wall]} стена · на {m(d.offset)} m · {m(d.width)} m</span><button class="icon-btn" aria-label="Махни вратата" style="color: var(--muted)" onclick={() => removeDoor(i)}><Icon name="trash" size={18} /></button></div>
              {/each}
            </div>
          {/if}

          {#if issues.length}
            <div class="section-title">Проверки</div>
            <div class="card" style="gap: 6px">
              {#each issues.filter(i => i.level !== 'ok') as i}<span style="font-size: 14px; color: {i.level === 'error' ? '#9B1C1C' : 'var(--accent-ink)'}">⚠ {i.text}</span>{/each}
              {#each issues.filter(i => i.level === 'ok') as i}<span style="font-size: 14px; color: var(--ok)">✓ {i.text}</span>{/each}
            </div>
          {/if}
        </aside>
      </div>
    {/if}
  </main>

  <Sheet bind:open={sizeOpen} title="Размери на помещението">
    <form class="stack" onsubmit={saveSize}>
      <div class="grid2">
        <div class="field"><label for="sw">Ширина (m)</label><input id="sw" class="mono" inputmode="decimal" bind:value={size.w} /></div>
        <div class="field"><label for="sd">Дълбочина (m)</label><input id="sd" class="mono" inputmode="decimal" bind:value={size.d} /></div>
      </div>
      <p class="muted" style="margin: 0">Вътрешни размери, от стена до стена. Ширина — по горната стена на плана.</p>
      <button class="btn primary block" type="submit">Запази</button>
    </form>
  </Sheet>

  <Sheet bind:open={rackOpen} title="Нов шкаф">
    <form class="stack" onsubmit={addRack}>
      <div class="grid2">
        <div class="field"><label for="nr">Име</label><input id="nr" class="mono" bind:value={rackForm.name} required /></div>
        <div class="field"><label for="nu">Височина (U)</label><input id="nu" type="number" min="1" max="60" bind:value={rackForm.uHeight} /></div>
        <div class="field"><label for="nw">Ширина (mm)</label><input id="nw" type="number" inputmode="numeric" bind:value={rackForm.widthMm} /></div>
        <div class="field"><label for="nd">Дълбочина (mm)</label><input id="nd" type="number" inputmode="numeric" bind:value={rackForm.depthMm} /></div>
      </div>
      <p class="muted" style="margin: 0">Шкафът се слага на първото свободно място с 0,60 m отзад. След това го местиш и завърташ.</p>
      <button class="btn primary block" type="submit">Сложи на плана</button>
    </form>
  </Sheet>

  <Sheet bind:open={itemOpen} title="Нов обект">
    <form class="stack" onsubmit={addItem}>
      <div class="kinds" role="radiogroup" aria-label="Вид обект">
        {#each Object.entries(ITEM_DEFS) as [k, d]}
          <label class="kind" class:on={newKind === k}>
            <input type="radio" name="kind" value={k} bind:group={newKind} />
            <span class="dot" style="background: {d.color}"></span>{d.label}
          </label>
        {/each}
      </div>
      <p class="muted" style="margin: 0">Ел. табло и климатик започват на горната стена, точковите обекти — в средата. После ги местиш.</p>
      <button class="btn primary block" type="submit">Сложи на плана</button>
    </form>
  </Sheet>

  <Sheet bind:open={doorOpen} title="Нова врата">
    <form class="stack" onsubmit={addDoor}>
      <div class="field">
        <label for="dw">Стена</label>
        <select id="dw" bind:value={door.wall}>{#each Object.entries(wallLabel) as [k, v]}<option value={k}>{v}</option>{/each}</select>
      </div>
      <div class="grid2">
        <div class="field"><label for="do">Разстояние от началото (m)</label><input id="do" class="mono" inputmode="decimal" bind:value={door.offset} /></div>
        <div class="field"><label for="dd">Ширина (m)</label><input id="dd" class="mono" inputmode="decimal" bind:value={door.width} /></div>
      </div>
      <p class="muted" style="margin: 0">Началото е левият край за горна и долна стена, горният — за лява и дясна.</p>
      <button class="btn primary block" type="submit">Добави</button>
    </form>
  </Sheet>
{/if}

<style>
  .plan-layout { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
  .plan-canvas { flex: 999 1 420px; min-width: 0; background: #fff; border-radius: var(--radius); padding: 10px; }
  .plan-canvas svg { width: 100%; height: auto; display: block; max-height: 75dvh; }
  .plan-side { flex: 1 1 300px; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
  .plan-rack { cursor: grab; outline: none; }
  .item-row { display: flex; gap: 10px; align-items: center; width: 100%; background: none; border: 0; border-bottom: 1px solid var(--line-2); cursor: pointer; }
  .item-row.on { background: #fff4ec; }
  .dot { width: 12px; height: 12px; border-radius: 3px; flex: none; display: inline-block; }
  .kinds { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; }
  .kind { display: flex; gap: 8px; align-items: center; border: 1px solid var(--field); border-radius: 10px; padding: 10px 12px; min-height: 48px; cursor: pointer; font-size: 15px; }
  .kind.on { border-color: var(--ink); background: #eef2f1; font-weight: 600; }
  .kind input { position: absolute; opacity: 0; pointer-events: none; }
  .plan-rack:focus-visible rect { stroke: #f08a4b; }
  .seg4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
  .seg4 .btn { padding: 0 4px; font-size: 13px; }
  .nudge { display: grid; grid-template-columns: repeat(3, 56px); gap: 6px; }
  .nudge .btn { height: 44px; font-size: 18px; }
  .hint-touch { display: none; }
  @media (hover: none) { .hint-mouse { display: none; } .hint-touch { display: block; } }
</style>
