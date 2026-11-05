<script lang="ts">
  import type { Face } from '../../core/model.ts';
  import { elevation, uLabel, usedUnits } from '../../core/rack.ts';
  import { db, deleteRack, save } from '../lib/db.ts';
  import { live } from '../lib/live.svelte.ts';
  import { go } from '../lib/router.svelte.ts';
  import { toast } from '../lib/ui.svelte.ts';
  import Icon from '../lib/Icon.svelte';
  import Sheet from '../lib/Sheet.svelte';
  import Photos from '../lib/Photos.svelte';

  let { id }: { id: string } = $props();

  const data = live(
    () => id,
    async rid => {
      const rack = await db.racks.get(rid);
      if (!rack) return null;
      const [room, devices] = await Promise.all([db.rooms.get(rack.roomId), db.devices.where('rackId').equals(rid).toArray()]);
      return { rack, room, devices };
    }
  );

  let face = $state<Face>('front');
  const rack = $derived(data.value?.rack);
  const devices = $derived(data.value?.devices ?? []);
  const segments = $derived(rack ? elevation(rack.uHeight, devices, face) : []);
  const byId = $derived(new Map(devices.map(d => [d.id, d])));
  const unracked = $derived(devices.filter(d => d.position === 0));
  const PX_PER_U = 22;

  let editOpen = $state(false);
  let photosOpen = $state(false);
  let form = $state({ name: '', uHeight: 42, notes: '' });

  async function saveRack(e: SubmitEvent) {
    e.preventDefault();
    if (!rack) return;
    const uHeight = Math.trunc(Number(form.uHeight));
    const highest = Math.max(0, ...devices.map(d => (d.position ? d.position + d.uHeight - 1 : 0)));
    if (uHeight < highest) return toast(`Има устройство до U${highest}; шкафът не може да е по-нисък.`);
    await save('racks', { ...$state.snapshot(rack), name: form.name.trim() || rack.name, uHeight, notes: form.notes });
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
      <button class="icon-btn" aria-label="Редактирай шкафа" onclick={() => { if (rack) { form = { name: rack.name, uHeight: rack.uHeight, notes: rack.notes }; editOpen = true; } }}><Icon name="edit" /></button>
    </div>
  </div>
  {#if rack}
    <div style="display: flex; justify-content: space-between; align-items: flex-end; gap: 12px">
      <div>
        <div class="title">{rack.name}</div>
        <div class="sub">{data.value?.room?.name ?? ''} · {rack.uHeight}U · {usedUnits(rack.uHeight, devices)} заети</div>
      </div>
      <div class="segmented" role="group" aria-label="Страна на шкафа">
        <button aria-pressed={face === 'front'} onclick={() => (face = 'front')}>Лице</button>
        <button aria-pressed={face === 'rear'} onclick={() => (face = 'rear')}>Гръб</button>
      </div>
    </div>
  {/if}
</header>

{#if data.loaded && !rack}
  <main><div class="empty">Шкафът не е намерен.</div></main>
{:else if rack}
  <main>
    <div class="legend">
      <span><i style="background: var(--ink)"></i>Потвърдено</span>
      <span><i style="background: var(--check); border: 1px solid var(--accent)"></i>За проверка</span>
      <span><i style="border: 1px dashed #8A979C"></i>Свободно · докосни за добавяне</span>
    </div>

    <div class="rack">
      {#each segments as seg (seg.kind + seg.top)}
        {#if seg.kind === 'free'}
          <a class="u-block free" style="min-height: {Math.max(28, Math.min(seg.top - seg.bottom + 1, 6) * PX_PER_U)}px"
            href={`#/d/new?rack=${rack.id}&top=${seg.top}&bottom=${seg.bottom}&face=${face}`}>
            <span class="u">{uLabel(seg.top, seg.bottom)}</span>
            <span class="name" style="font-weight: 400">Свободно · {seg.top - seg.bottom + 1}U</span>
            <Icon name="plus" size={16} />
          </a>
        {:else}
          {@const d = byId.get(seg.id)!}
          <a class="u-block device {d.status}" style="min-height: {Math.max(28, (seg.top - seg.bottom + 1) * PX_PER_U)}px" href={'#/d/' + d.id}>
            <span class="u">{uLabel(seg.top, seg.bottom)}</span>
            <span class="name">{d.name || d.model || 'без име'}{d.model && d.name ? ' · ' + d.model : ''}</span>
            <span class="meta">{d.face !== face ? 'от другата страна' : d.status === 'check' ? 'провери' : ''}</span>
          </a>
        {/if}
      {/each}
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
      <div class="field"><label for="no">Бележки</label><textarea id="no" bind:value={form.notes}></textarea></div>
      <button class="btn primary block" type="submit">Запази</button>
      <button class="btn danger block" type="button" onclick={remove}><Icon name="trash" size={18} /> Изтрий шкафа</button>
    </form>
  </Sheet>
{/if}
