<script lang="ts">
  import { router } from './lib/router.svelte.ts';
  import { ui, loadIdentity } from './lib/ui.svelte.ts';
  import Home from './views/Home.svelte';
  import SurveyView from './views/Survey.svelte';
  import RackView from './views/Rack.svelte';
  import DeviceForm from './views/DeviceForm.svelte';
  import Settings from './views/Settings.svelte';

  loadIdentity();
</script>

<div class="app">
  {#if router.route.name === 'survey'}
    {#key router.route.id}<SurveyView id={router.route.id} />{/key}
  {:else if router.route.name === 'rack'}
    {#key router.route.id}<RackView id={router.route.id} />{/key}
  {:else if router.route.name === 'device'}
    {#key router.route.id + router.route.params.toString()}<DeviceForm id={router.route.id} params={router.route.params} />{/key}
  {:else if router.route.name === 'settings'}
    <Settings />
  {:else}
    <Home />
  {/if}
</div>

{#if ui.toast}<div class="toast" role="status">{ui.toast}</div>{/if}
