<script lang="ts">
  import type { Face } from '../../core/model.ts';
  import { usedUnits } from '../../core/rack.ts';
  import { db, deleteRack, save } from '../lib/db.ts';
  import { live } from '../lib/live.svelte.ts';
  import { go } from '../lib/router.svelte.ts';
  import { toast } from '../lib/ui.svelte.ts';
  import Icon from '../lib/Icon.svelte';
  import Sheet from '../lib/Sheet.svelte';
  import Photos from '../lib/Photos.svelte';
  import RackElevation from '../lib/RackElevation.svelte';
  import { roleColors } from '../../core/roles.ts';

  let { id }: { id: string } = $props();

  const data = live(
    () => id,
    async rid => {
      const rack = await db.racks.get(rid);
      if (!rack) return null;
      const [room, devices, rooms] = await Promise.all([
        db.rooms.get(rack.roomId),
        db.devices.where('rackId').equals(rid).toArray(),
        db.rooms.where('surveyId').equals(rack.surveyId).sortBy('name')
      ]);
      return { rack, room, devices, rooms };
    }
  );

  let face = $state<Face>('front');
  const rack = $derived(data.value?.rack);
  const devices = $derived(data.value?.devices ?? []);
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
    </div>

    <div style="display: flex; gap: 28px; flex-wrap: wrap; align-items: flex-start">
      {#if wide}
        <RackElevation {rack} {devices} face="front" uPx={17} {childCount} label="Лице" />
        <RackElevation {rack} {devices} face="rear" uPx={17} {childCount} label="Гръб" />
      {:else}
        <RackElevation {rack} {devices} {face} uPx={20} {childCount} />
      {/if}
    </div>

    <div class="section-title">
      Без U позиция (0U, PDU, на рафт)
      <a class="btn small" href={`#/d/new?rack=${rack.id}&top=0&bottom=0&face=${face}`}><Icon name="plus" size={16} /> Добави</a>
    </div>
    {#if unracked.length}
      <div class="list">
        {#each unracked as d (d.id)}
          <a href={'#/d/' + d.id}>
            <span><b>{d.name || d.model || 'без име'}</b><br /><span class="muted">{d.manufacturer} {d.model}</span></span>
            <span class="tag {d.status}">{d.status === 'check' ? 'За проверка' : 'Потвърдено'}</span>
          </a>
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
