<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let { open = $bindable(false), title, children }: { open: boolean; title: string; children: Snippet } = $props();
  let dialog: HTMLDialogElement;

  $effect(() => {
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<dialog class="sheet" bind:this={dialog} onclose={() => (open = false)} aria-label={title}>
  <div class="sheet-head">
    <h2 style="font-size: 18px">{title}</h2>
    <button class="icon-btn" type="button" aria-label="Затвори" onclick={() => (open = false)}><Icon name="close" /></button>
  </div>
  <div class="sheet-body">
    {#if open}{@render children()}{/if}
  </div>
</dialog>
