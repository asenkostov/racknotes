<script lang="ts">
  import { router } from './lib/router.svelte.ts';
  import { ui, loadIdentity } from './lib/ui.svelte.ts';
  import { startSync } from './lib/sync.svelte.ts';
  import { applyUpdate, pwa, startPwa } from './lib/pwa.svelte.ts';
  import Home from './views/Home.svelte';
  import SurveyView from './views/Survey.svelte';
  import RackView from './views/Rack.svelte';
  import DeviceForm from './views/DeviceForm.svelte';
  import Settings from './views/Settings.svelte';
  import Import from './views/Import.svelte';
  import RoomView from './views/Room.svelte';
  import RoomPlan from './views/RoomPlan.svelte';
  import Room3D from './views/Room3D.svelte';

  loadIdentity();
  startSync();
  startPwa();
</script>

<div class="app" class:wide={router.route.name === 'rack' || router.route.name === 'plan' || router.route.name === 'room3d'}>
  {#if router.route.name === 'survey'}
    {#key router.route.id}<SurveyView id={router.route.id} />{/key}
  {:else if router.route.name === 'room3d'}
    {#key router.route.id}<Room3D id={router.route.id} />{/key}
  {:else if router.route.name === 'plan'}
    {#key router.route.id}<RoomPlan id={router.route.id} />{/key}
  {:else if router.route.name === 'room'}
    {#key router.route.id}<RoomView id={router.route.id} />{/key}
  {:else if router.route.name === 'rack'}
    {#key router.route.id}<RackView id={router.route.id} />{/key}
  {:else if router.route.name === 'device'}
    {#key router.route.id + router.route.params.toString()}<DeviceForm id={router.route.id} params={router.route.params} />{/key}
  {:else if router.route.name === 'settings'}
    <Settings />
  {:else if router.route.name === 'import'}
    <Import />
  {:else}
    <Home />
  {/if}
</div>

{#if ui.toast}<div class="toast" role="status">{ui.toast}</div>{/if}

{#if pwa.needRefresh}
  <div class="update" role="status">
    <span>Има нова версия на RackNotes.</span>
    <button class="btn small primary" onclick={applyUpdate} disabled={pwa.updating}>{pwa.updating ? 'Зарежда…' : 'Презареди'}</button>
    <button class="icon-btn" aria-label="По-късно" onclick={() => (pwa.needRefresh = false)}>✕</button>
  </div>
{/if}
