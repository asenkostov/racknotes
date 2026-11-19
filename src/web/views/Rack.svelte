<script lang="ts">
  import type { Device, Face } from '../../core/model.ts';
  import { placementError, uLabel, usedUnits } from '../../core/rack.ts';
  import { db, deleteRack, save } from '../lib/db.ts';
  import { live } from '../lib/live.svelte.ts';
  import { go } from '../lib/router.svelte.ts';
  import { toast } from '../lib/ui.svelte.ts';
  import Icon from '../lib/Icon.svelte';
  import Sheet from '../lib/Sheet.svelte';
  import Photos from '../lib/Photos.svelte';
  import RackElevation from '../lib/RackElevation.svelte';
  import { roleColors } from '../../core/roles.ts';
  import { STATE_LABELS, STATE_SYMBOLS, nextPending, summary, verifyState } from '../../core/verify.ts';

  let { id }: { id: string } = $props();

  const data = live(
    () => id,
    async rid => {
      const rack = await db.racks.get(rid);
      if (!rack) return null;
      const [room, devices, rooms, survey] = await Promise.all([
        db.rooms.get(rack.roomId),
        db.devices.where('rackId').equals(rid).toArray(),
        db.rooms.where('surveyId').equals(rack.surveyId).sortBy('name'),
        db.surveys.get(rack.surveyId)
      ]);
      return { rack, room, devices, rooms, survey };
    }
  );

  let face = $state<Face>('front');
  // Show device photos from the type library, or plain role colours. Remembered per browser.
  let images = $state(true);
  try {
    images = localStorage.getItem('rn.rackImages') !== '0';
  } catch {}
  function toggleImages() {
    images = !images;
    try {
      localStorage.setItem('rn.rackImages', images ? '1' : '0');
    } catch {}
  }
  const rack = $derived(data.value?.rack);
  const devices = $derived(data.value?.devices ?? []);
  const verifying = $derived(!!data.value?.survey?.verify);

  // --- move mode: pick a device, then ↑/↓ or tap free space ---
  let moveMode = $state(false);
  let movingId = $state('');
  const moving = $derived(devices.find(d => d.id === movingId));
  const placedDevs = $derived(devices.filter(d => !d.parentId));
  function startMove() {
    moveMode = true;
    movingId = '';
  }
  function stopMove() {
    moveMode = false;
    movingId = '';
  }
  function pickDev(d: Device) {
    if (d.parentId) return toast('Устройството е вътре в друго — премести него.');
    movingId = movingId === d.id ? '' : d.id;
  }
  /** Try a new spot; returns true when saved. */
  async function moveTo(d: Device, position: number, f: Face = d.face): Promise<boolean> {
    if (!rack) return false;
    const err = placementError(rack.uHeight, placedDevs, { ...d, position, face: f });
    if (err) {
      toast(err);
      return false;
    }
    await save('devices', $state.snapshot({ ...d, position, face: f }));
    return true;
  }
  async function step(delta: number) {
    if (!moving || !moving.position) return;
    await moveTo(moving, moving.position + delta);
  }
  async function flip() {
    if (!moving) return;
    await moveTo(moving, moving.position, moving.face === 'front' ? 'rear' : 'front');
  }
  async function unplace() {
    if (moving) await moveTo(moving, 0);
  }
  /** Tapped free space: the nearest position that covers it, aligned to its top when possible. */
  async function target(f: Face, top: number, bottom: number, at = top) {
    const d = moving;
    if (!d || !rack) return;
    const h = Math.max(1, d.uHeight);
    const face = d.fullDepth !== false ? d.face : f;
    // Positions (lowest U) that cover the tapped U, nearest first: its top at the tapped U, then shifted.
    const tries: number[] = [];
    for (let k = 0; k < h + (top - bottom) + 1; k++) for (const p of [at - h + 1 + k, at - h + 1 - k]) if (!tries.includes(p)) tries.push(p);
    const ok = tries.find(p => p >= 1 && p <= top && p + h - 1 >= bottom && !placementError(rack.uHeight, placedDevs, { ...d, position: p, face }));
    if (ok === undefined) return toast(`Не се побира: устройството е ${h}U.`);
    await moveTo(d, ok, face);
  }
  const vsum = $derived(summary(devices));
  const next = $derived(verifying ? nextPending(devices) : undefined);
  const withImages = $derived(devices.filter(d => d.catalog?.front || d.catalog?.rear).length);
  const unracked = $derived(devices.filter(d => d.position === 0 && !d.parentId));
  const childCount = $derived(devices.reduce((m, d) => (d.parentId ? m.set(d.parentId, (m.get(d.parentId) ?? 0) + 1) : m), new Map<string, number>()));
  // Two faces side by side when there is room; one face with a toggle on phones.
  let wide = $state(matchMedia('(min-width: 760px)').matches);
  $effect(() => {
    const mq = matchMedia('(min-width: 760px)');
    const on = () => (wide = mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });
  const legend = $derived(
    [...new Map(devices.filter(d => !d.parentId && d.position > 0).map(d => [d.role || '—', roleColors(d.role, d.roleColor).bg])).entries()].sort((a, b) => a[0].localeCompare(b[0], 'bg'))
  );

  let editOpen = $state(false);
  let photosOpen = $state(false);
  let form = $state({ name: '', uHeight: 42, notes: '', roomId: '' });

  async function saveRack(e: SubmitEvent) {
    e.preventDefault();
    if (!rack) return;
    const uHeight = Math.trunc(Number(form.uHeight));
    const highest = Math.max(0, ...devices.map(d => (d.position ? d.position + d.uHeight - 1 : 0)));
    if (uHeight < highest) return toast(`Има устройство до U${highest}; шкафът не може да е по-нисък.`);
    await save('racks', { ...$state.snapshot(rack), name: form.name.trim() || rack.name, uHeight, notes: form.notes, roomId: form.roomId || rack.roomId });
    editOpen = false;
  }

  async function remove() {
    if (!rack || !confirm(`Да изтрия ли шкаф ${rack.name} с всичките ${devices.length} устройства в него?`)) return;
    const surveyId = rack.surveyId;
    await deleteRack(rack.id);
    go('/s/' + surveyId);
  }
</script>

<header class="topbar">
  <div class="row">
    <a class="icon-btn" href={rack ? '#/s/' + rack.surveyId : '#/'} aria-label="Назад към огледа" style="margin-left: -10px"><Icon name="back" /></a>
    <div style="display: flex">
      <button class="icon-btn" aria-label="Снимки на шкафа" onclick={() => (photosOpen = true)}><Icon name="camera" /></button>
      <button class="icon-btn" aria-label="Редактирай шкафа" onclick={() => { if (rack) { form = { name: rack.name, uHeight: rack.uHeight, notes: rack.notes, roomId: rack.roomId }; editOpen = true; } }}><Icon name="edit" /></button>
    </div>
  </div>
  {#if rack}
    <div style="display: flex; justify-content: space-between; align-items: flex-end; gap: 12px">
      <div>
        <div class="title">{rack.name}</div>
        <div class="sub">{data.value?.room?.name ?? ''} · {rack.uHeight}U · {usedUnits(rack.uHeight, devices)} заети</div>
      </div>
      {#if !wide}<div class="segmented" role="group" aria-label="Страна на шкафа">
        <button aria-pressed={face === 'front'} onclick={() => (face = 'front')}>Лице</button>
        <button aria-pressed={face === 'rear'} onclick={() => (face = 'rear')}>Гръб</button>
      </div>{/if}
    </div>
  {/if}
</header>

{#if data.loaded && !rack}
  <main><div class="empty">Шкафът не е намерен.</div></main>
{:else if rack}
  <main>
    <div class="legend">
      {#each legend as [role, bg]}<span><i style="background: {bg}"></i>{role}</span>{/each}
      <span><i style="box-shadow: inset 0 0 0 2px var(--accent)"></i>За проверка</span>
      <span><i style="background: repeating-linear-gradient(45deg, #c9d2cf 0 2px, #fff 2px 4px); border: 1px solid #8a979c"></i>Монтирано от другата страна</span>
      <button class="btn small" style="margin-left: auto; height: 32px" class:dark={moveMode} aria-pressed={moveMode} onclick={() => (moveMode ? stopMove() : startMove())}>{moveMode ? 'Готово' : '↕ Премести'}</button>
      {#if withImages}
        <button class="btn small" style="height: 32px" aria-pressed={images} onclick={toggleImages}>{images ? 'Цветове' : 'Изгледи'}</button>
      {/if}
    </div>

    {#if moveMode}
      <div class="card movebar">
        {#if moving}
          <div style="display: flex; justify-content: space-between; gap: 8px; align-items: baseline; flex-wrap: wrap">
            <b>{moving.name || moving.model}</b>
            <span class="muted mono">{moving.position ? uLabel(moving.position + moving.uHeight - 1, moving.position) : 'без U'} · {moving.face === 'front' ? 'лице' : 'гръб'}</span>
          </div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap">
            <button class="btn small" aria-label="Една U нагоре" onclick={() => step(1)} disabled={!moving.position}>↑ 1U</button>
            <button class="btn small" aria-label="Една U надолу" onclick={() => step(-1)} disabled={!moving.position}>↓ 1U</button>
            <button class="btn small" onclick={flip} disabled={!moving.position}>⇄ {moving.face === 'front' ? 'на гърба' : 'на лицето'}</button>
            <button class="btn small" onclick={unplace} disabled={!moving.position}>Без U</button>
            <button class="btn small" onclick={() => (movingId = '')}>Друго</button>
          </div>
          <span class="muted" style="font-size: 13px">Или докосни свободно място, за да го сложиш там.</span>
        {:else}
          <span>Докосни устройството, което да преместиш. Рафт или шаси се мести заедно с това, което е в него.</span>
        {/if}
      </div>
    {/if}

    {#if verifying && vsum.total + vsum.new}
      <div class="card vbar">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap">
          <b>Проверка: {vsum.done} от {vsum.total}</b>
          {#if next}<a class="btn small dark" href={'#/d/' + next.id} style="text-decoration: none">Следващо: {next.name || next.model} →</a>
          {:else if vsum.total}<span style="color: var(--ok); font-weight: 600">✓ Шкафът е проверен</span>{/if}
        </div>
        <div class="bar"><div style="width: {vsum.total ? Math.round((vsum.done / vsum.total) * 100) : 100}%"></div></div>
        <span class="muted" style="font-size: 13px">✓ {vsum.ok} съвпадат · ✎ {vsum.changed} различни · ✗ {vsum.missing} липсват · + {vsum.new} нови</span>
      </div>
    {/if}

    <div style="display: flex; gap: 28px; flex-wrap: wrap; align-items: flex-start">
      {#if wide}
        <RackElevation {rack} {devices} face="front" uPx={17} {childCount} {images} {verifying} label="Лице" moving={movingId} onpick={moveMode ? pickDev : undefined} ontarget={target} />
        <RackElevation {rack} {devices} face="rear" uPx={17} {childCount} {images} {verifying} label="Гръб" moving={movingId} onpick={moveMode ? pickDev : undefined} ontarget={target} />
      {:else}
        <RackElevation {rack} {devices} {face} uPx={20} {childCount} {images} {verifying} moving={movingId} onpick={moveMode ? pickDev : undefined} ontarget={target} />
      {/if}
    </div>

    <div class="section-title">
      Без U позиция (0U, PDU, на рафт)
      <a class="btn small" href={`#/d/new?rack=${rack.id}&top=0&bottom=0&face=${face}`}><Icon name="plus" size={16} /> Добави</a>
    </div>
    {#if unracked.length}
      <div class="list">
        {#each unracked as d (d.id)}
          <svelte:element this={moveMode ? 'button' : 'a'} href={moveMode ? undefined : '#/d/' + d.id} type={moveMode ? 'button' : undefined} role={moveMode ? 'button' : 'link'} onclick={moveMode ? () => pickDev(d) : undefined} class:picked={movingId === d.id} class="unr">
            <span><b>{d.name || d.model || 'без име'}</b><br /><span class="muted">{d.manufacturer} {d.model}</span></span>
            {#if verifying}
              {@const st = verifyState(d)}
              <span class="vtag v-{st}">{STATE_SYMBOLS[st]} {STATE_LABELS[st]}</span>
            {:else}
              <span class="tag {d.status}">{d.status === 'check' ? 'За проверка' : 'Потвърдено'}</span>
            {/if}
          </svelte:element>
        {/each}
      </div>
    {/if}
  </main>

  <Sheet bind:open={photosOpen} title={'Снимки · ' + rack.name}>
    <Photos surveyId={rack.surveyId} ownerKind="rack" ownerId={rack.id} />
  </Sheet>

  <Sheet bind:open={editOpen} title="Шкаф">
    <form class="stack" onsubmit={saveRack}>
      <div class="grid2">
        <div class="field"><label for="n">Име</label><input id="n" class="mono" bind:value={form.name} required /></div>
        <div class="field"><label for="h">Височина (U)</label><input id="h" type="number" min="1" max="60" bind:value={form.uHeight} /></div>
      </div>
      <div class="field">
        <label for="rm">Помещение</label>
        <select id="rm" bind:value={form.roomId}>{#each data.value?.rooms ?? [] as r (r.id)}<option value={r.id}>{r.name}</option>{/each}</select>
      </div>
      <div class="field"><label for="no">Бележки</label><textarea id="no" bind:value={form.notes}></textarea></div>
      <button class="btn primary block" type="submit">Запази</button>
      <button class="btn danger block" type="button" onclick={remove}><Icon name="trash" size={18} /> Изтрий шкафа</button>
    </form>
  </Sheet>
{/if}

<style>
  .movebar { gap: 8px; position: sticky; top: 8px; z-index: 5; border: 2px solid #f08a4b; }
  button.unr { width: 100%; background: none; border: 0; border-bottom: 1px solid var(--line-2); font: inherit; text-align: left; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
  .unr.picked { outline: 3px solid #f08a4b; outline-offset: -3px; }

  .vbar { gap: 8px; }
</style>
