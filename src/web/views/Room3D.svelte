<script lang="ts">
  import { onDestroy } from 'svelte';
  import { checkPlan } from '../../core/plan.ts';
  import { usedUnits } from '../../core/rack.ts';
  import { db } from '../lib/db.ts';
  import { live } from '../lib/live.svelte.ts';
  import Icon from '../lib/Icon.svelte';
  import type { View } from '../lib/room3d.ts';

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
  const placed = $derived((data.value?.racks ?? []).filter(r => r.plan));
  const unplaced = $derived((data.value?.racks.length ?? 0) - placed.length);

  let canvas: HTMLCanvasElement | undefined = $state();
  let scene: Awaited<ReturnType<typeof import('../lib/room3d.ts').createRoomScene>> | null = $state(null);
  let failed = $state('');
  let selId = $state<string | null>(null);
  let current = $state<View>('iso');
  let zones = $state(true);
  const sel = $derived(data.value?.racks.find(r => r.id === selId));

  $effect(() => {
    if (!canvas || scene) return;
    const el = canvas;
    import('../lib/room3d.ts')
      .then(m => {
        try {
          scene = m.createRoomScene(el, rid => (selId = rid));
        } catch (e) {
          failed = 'Този браузър не може да покаже 3D изглед (WebGL не е наличен).';
        }
      })
      .catch(() => (failed = 'Не успях да заредя 3D изгледа. Провери връзката и опитай пак.'));
  });

  $effect(() => {
    const v = data.value;
    if (!scene || !v) return;
    const flagged = new Set(checkPlan(v.room, v.racks).filter(i => i.level !== 'ok' && i.rackId).map(i => i.rackId!));
    scene.update({ room: $state.snapshot(v.room), racks: $state.snapshot(v.racks), devices: $state.snapshot(v.devices), flagged });
  });

  function setView(v: View) {
    current = v;
    scene?.view(v);
  }
  function toggleZones() {
    zones = !zones;
    scene?.setZones(zones);
  }
  onDestroy(() => scene?.dispose());
</script>

<header class="topbar">
  <div class="row">
    <a class="icon-btn" href={'#/room/' + id} aria-label="Назад към помещението" style="margin-left: -10px"><Icon name="back" /></a>
    {#if room}<a class="btn small" style="background: transparent; color: #fff; border-color: #4e6570; text-decoration: none" href={'#/room/' + id + '/plan'}>План</a>{/if}
  </div>
  {#if room}
    <div>
      <div class="title">3D · {room.name}</div>
      <div class="sub">{hasSize ? `${room.widthM!.toFixed(2).replace('.', ',')} × ${room.depthM!.toFixed(2).replace('.', ',')} m` : 'без размери'} · {placed.length} {placed.length === 1 ? 'шкаф' : 'шкафа'}</div>
    </div>
  {/if}
</header>

{#if data.loaded && !room}
  <main><div class="empty">Помещението не е намерено.</div></main>
{:else if room && !hasSize}
  <main>
    <div class="card">
      <h2 style="font-size: 17px">Няма план за това помещение</h2>
      <p class="muted" style="margin: 0">3D изгледът се строи от плана. Задай размерите и разположи шкафовете.</p>
      <a class="btn primary" href={'#/room/' + id + '/plan'}>Към плана</a>
    </div>
  </main>
{:else if room}
  <main>
    <div class="view3d">
      <canvas bind:this={canvas} aria-label={`3D изглед на ${room.name}`}></canvas>
      {#if !scene && !failed}<div class="overlay muted">Зареждам 3D…</div>{/if}
      {#if failed}<div class="overlay">{failed}</div>{/if}
      <div class="tools">
        {#each [['iso', '3D'], ['top', 'Отгоре'], ['front', 'Отпред']] as [k, l]}
          <button class="btn small" class:dark={current === k} aria-pressed={current === k} onclick={() => setView(k as View)}>{l}</button>
        {/each}
        <button class="btn small" class:dark={zones} aria-pressed={zones} onclick={toggleZones}>Зони</button>
      </div>
    </div>
    <p class="muted" style="margin: 0; font-size: 13px">Въртиш с един пръст, местиш с два, приближаваш с щипване. Докосни шкаф, за да го избереш.</p>
    <div class="legend">
      <span><i style="background: rgba(59,130,246,.35)"></i>Отпред {'≥'} 1,0 m</span>
      <span><i style="background: rgba(138,151,156,.4)"></i>Отзад {'≥'} 0,6 m</span>
      <span><i style="background: rgba(240,138,75,.4)"></i>Отваряне на вратата</span>
      <span><i style="background: rgba(124,58,237,.3)"></i>Врати на шкафа</span>
      <span><i style="border: 2px solid #C2410C"></i>Има забележка в плана</span>
    </div>

    {#if sel}
      {@const devs = data.value?.devices.filter(d => d.rackId === sel.id) ?? []}
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: baseline">
          <h2 style="font-size: 18px; font-family: var(--mono)">{sel.name}</h2>
          <a href={'#/r/' + sel.id} style="font-size: 14px; font-weight: 600">По U →</a>
        </div>
        <span class="muted">{sel.uHeight}U · {usedUnits(sel.uHeight, devs)} заети · {devs.length} {devs.length === 1 ? 'устройство' : 'устройства'}</span>
      </div>
    {/if}
    {#if unplaced > 0}
      <p class="muted" style="margin: 0">{unplaced} {unplaced === 1 ? 'шкаф не е' : 'шкафа не са'} на плана и не се показва{unplaced === 1 ? '' : 'т'}. <a href={'#/room/' + id + '/plan'}>Разположи в плана</a></p>
    {/if}
  </main>
{/if}

<style>
  .view3d { position: relative; background: #f2f4f3; border-radius: var(--radius); overflow: hidden; border: 1px solid var(--line-2); }
  canvas { display: block; width: 100%; height: min(68dvh, 620px); touch-action: none; }
  .overlay { position: absolute; inset: 0; display: grid; place-items: center; padding: 20px; text-align: center; }
  .tools { position: absolute; left: 8px; right: 8px; bottom: 8px; display: flex; gap: 6px; flex-wrap: wrap; }
  .tools .btn { background: #fff; }
  .tools .btn.dark { background: var(--ink); }
</style>
