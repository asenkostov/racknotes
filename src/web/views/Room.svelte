<script lang="ts">
  import type { Floor, Rack } from '../../core/model.ts';
  import { meta } from '../../core/model.ts';
  import { usedUnits } from '../../core/rack.ts';
  import { ITEM_DEFS, footprint, itemBox } from '../../core/plan.ts';
  import { db, deleteRoom, save } from '../lib/db.ts';
  import { live } from '../lib/live.svelte.ts';
  import { go } from '../lib/router.svelte.ts';
  import { toast } from '../lib/ui.svelte.ts';
  import { plural } from '../lib/labels.ts';
  import Icon from '../lib/Icon.svelte';
  import Sheet from '../lib/Sheet.svelte';
  import Photos from '../lib/Photos.svelte';

  let { id }: { id: string } = $props();

  const data = live(
    () => id,
    async rid => {
      const room = await db.rooms.get(rid);
      if (!room) return null;
      const [floor, floors, racks] = await Promise.all([
        db.floors.get(room.floorId),
        db.floors.where('surveyId').equals(room.surveyId).sortBy('level'),
        db.racks.where('roomId').equals(rid).sortBy('name')
      ]);
      const devices = await db.devices.where('rackId').anyOf(racks.map(r => r.id)).toArray();
      return { room, floor, floors, racks, devices };
    }
  );
  const room = $derived(data.value?.room);

  // --- edit room (name, floor) ---
  let editOpen = $state(false);
  let form = $state({ name: '', level: 0, floorName: '' });
  function openEdit() {
    if (!data.value) return;
    form = { name: data.value.room.name, level: data.value.floor?.level ?? 0, floorName: data.value.floor?.name ?? '' };
    editOpen = true;
  }
  async function saveEdit(e: SubmitEvent) {
    e.preventDefault();
    const v = data.value;
    if (!v || !form.name.trim()) return;
    const level = Math.trunc(Number(form.level) || 0);
    let floor = v.floors.find(f => f.level === level);
    if (!floor) {
      floor = { ...meta(), surveyId: v.room.surveyId, level, name: form.floorName.trim() || `Етаж ${level}` } satisfies Floor;
      await save('floors', floor);
    } else if (form.floorName.trim() && form.floorName.trim() !== floor.name) {
      await save('floors', { ...$state.snapshot(floor), name: form.floorName.trim() });
    }
    await save('rooms', { ...$state.snapshot(v.room), name: form.name.trim(), floorId: floor.id });
    editOpen = false;
    toast('Запазено.');
  }

  async function remove() {
    const v = data.value;
    if (!v) return;
    if (v.racks.length) return toast(`В помещението има ${plural(v.racks.length, 'шкаф', 'шкафа')}. Премести или изтрий шкафовете първо.`);
    if (!confirm(`Да изтрия ли помещение „${v.room.name}“?`)) return;
    await deleteRoom(v.room.id);
    go('/s/' + v.room.surveyId);
  }

  // --- add rack here ---
  let rackOpen = $state(false);
  let rackForm = $state({ name: '', uHeight: 42 });
  async function addRack(e: SubmitEvent) {
    e.preventDefault();
    const v = data.value;
    if (!v || !rackForm.name.trim()) return;
    const uHeight = Math.trunc(Number(rackForm.uHeight));
    if (!(uHeight >= 1 && uHeight <= 60)) return toast('Височината трябва да е между 1 и 60 U.');
    const rack: Rack = { ...meta(), surveyId: v.room.surveyId, roomId: v.room.id, name: rackForm.name.trim(), uHeight, notes: '' };
    await save('racks', rack);
    rackOpen = false;
    go('/r/' + rack.id);
  }
</script>

<header class="topbar">
  <div class="row">
    <a class="icon-btn" href={room ? '#/s/' + room.surveyId : '#/'} aria-label="Назад към огледа" style="margin-left: -10px"><Icon name="back" /></a>
    <button class="icon-btn" aria-label="Редактирай помещението" onclick={openEdit}><Icon name="edit" /></button>
  </div>
  {#if room}
    <div>
      <div class="title">{room.name}</div>
      <div class="sub">{data.value?.floor?.name ?? ''} · {plural(data.value?.racks.length ?? 0, 'шкаф', 'шкафа')}</div>
    </div>
  {/if}
</header>

{#if data.loaded && !room}
  <main><div class="empty">Помещението не е намерено.</div></main>
{:else if room && data.value}
  <main>
    <div class="section-title">
      Шкафове
      <button class="btn small" onclick={() => { rackForm = { name: `R${String((data.value?.racks.length ?? 0) + 1).padStart(2, '0')}`, uHeight: 42 }; rackOpen = true; }}><Icon name="plus" size={16} /> Шкаф</button>
    </div>
    {#if !data.value.racks.length}<div class="empty">Няма шкафове в това помещение.</div>{/if}
    {#each data.value.racks as rack (rack.id)}
      {@const used = usedUnits(rack.uHeight, data.value.devices.filter(d => d.rackId === rack.id))}
      <a class="card" href={'#/r/' + rack.id}>
        <div style="display: flex; justify-content: space-between; align-items: baseline">
          <span style="font-weight: 600; font-size: 17px">{rack.name}</span>
          <span class="mono muted" style="font-size: 13px">{rack.uHeight}U · {used} заети</span>
        </div>
        <div class="bar"><div style="width: {Math.round((used / rack.uHeight) * 100)}%"></div></div>
      </a>
    {/each}

    <div class="section-title">Снимки на помещението</div>
    <div class="card"><Photos surveyId={room.surveyId} ownerKind="room" ownerId={room.id} /></div>

    <div class="section-title">План на помещението</div>
    <a class="card plan-card" href={'#/room/' + room.id + '/plan'}>
      {#if room.widthM && room.depthM}
        {@const W = room.widthM * 100}
        {@const D = room.depthM * 100}
        <svg viewBox={`-10 -10 ${W + 20} ${D + 20}`} style="width: 100%; max-height: 220px" aria-hidden="true">
          <rect x="0" y="0" width={W} height={D} fill="#F4F6F5" stroke="#13232B" stroke-width={Math.max(W, D) / 120} />
          {#each room.items ?? [] as it}
            {@const b = itemBox(it)}
            {#if b}<rect x={b.x * 100} y={b.y * 100} width={b.w * 100} height={b.h * 100} fill={ITEM_DEFS[it.kind].color} opacity="0.45" />
            {:else}<circle cx={it.x * 100} cy={it.y * 100} r={Math.max(room.widthM ?? 1, room.depthM ?? 1) * 1.6} fill={ITEM_DEFS[it.kind].color} />{/if}
          {/each}
          {#each data.value?.racks ?? [] as r}
            {@const b = footprint(r)}
            {#if b}<rect x={b.x * 100} y={b.y * 100} width={b.w * 100} height={b.h * 100} fill="#2B3A40" stroke="#F4F6F5" stroke-width={Math.max(W, D) / 200} />{/if}
          {/each}
        </svg>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span class="muted mono">{room.widthM.toFixed(2).replace('.', ',')} × {room.depthM.toFixed(2).replace('.', ',')} m · {(data.value?.racks ?? []).filter(r => r.plan).length} от {data.value?.racks.length ?? 0} шкафа</span>
          <b>Отвори плана →</b>
        </div>
      {:else}
        <span class="muted">Още няма план. Задай размерите на помещението и разположи шкафовете.</span>
        <b>Задай размери →</b>
      {/if}
    </a>
    {#if room.widthM && room.depthM}
      <a class="btn block" href={'#/room/' + room.id + '/3d'}>3D изглед на помещението</a>
    {/if}
    <a class="btn block" href={'#/floor/' + room.floorId}>{room.floor ? 'Виж на плана на етажа' : 'Сложи на плана на етажа'}</a>
  </main>

  <Sheet bind:open={editOpen} title="Помещение">
    <form class="stack" onsubmit={saveEdit}>
      <div class="field"><label for="rn">Име</label><input id="rn" bind:value={form.name} required /></div>
      <div class="grid2">
        <div class="field"><label for="lv">Етаж (−1, 0, 1 …)</label><input id="lv" type="number" step="1" bind:value={form.level} /></div>
        <div class="field"><label for="fn">Име на етажа</label><input id="fn" bind:value={form.floorName} placeholder="Етаж 1" /></div>
      </div>
      <p class="muted" style="margin: 0">Името на етажа важи за всички помещения на този етаж.</p>
      <button class="btn primary block" type="submit">Запази</button>
      <button class="btn danger block" type="button" onclick={remove}><Icon name="trash" size={18} /> Изтрий помещението</button>
    </form>
  </Sheet>

  <Sheet bind:open={rackOpen} title={'Нов шкаф в ' + room.name}>
    <form class="stack" onsubmit={addRack}>
      <div class="grid2">
        <div class="field"><label for="rk">Име</label><input id="rk" bind:value={rackForm.name} class="mono" required /></div>
        <div class="field"><label for="ru">Височина (U)</label><input id="ru" type="number" min="1" max="60" bind:value={rackForm.uHeight} /></div>
      </div>
      <button class="btn primary block" type="submit">Създай и отвори</button>
    </form>
  </Sheet>
{/if}

<style>
  .plan-card { color: inherit; text-decoration: none; }
</style>
