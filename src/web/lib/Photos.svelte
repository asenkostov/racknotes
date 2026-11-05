<script lang="ts">
  import type { OwnerKind, Photo } from '../../core/model.ts';
  import { meta } from '../../core/model.ts';
  import { db } from './db.ts';
  import { live } from './live.svelte.ts';
  import { compressPhoto } from './photo.ts';
  import { toast } from './ui.svelte.ts';
  import Icon from './Icon.svelte';

  let { surveyId, ownerKind, ownerId }: { surveyId: string; ownerKind: OwnerKind; ownerId: string } = $props();

  const photos = live(
    () => [ownerKind, ownerId] as const,
    ([k, id]) => db.photos.where('[ownerKind+ownerId]').equals([k, id]).sortBy('createdAt')
  );

  // Object URLs for thumbnails; revoked when the list changes or the component goes away.
  let urls = $state<Record<string, string>>({});
  $effect(() => {
    const list = photos.value ?? [];
    const next: Record<string, string> = {};
    for (const p of list) next[p.id] = URL.createObjectURL(p.blob);
    urls = next;
    return () => Object.values(next).forEach(u => URL.revokeObjectURL(u));
  });

  let input: HTMLInputElement;
  let viewer: HTMLDialogElement;
  let current = $state<Photo | null>(null);
  let busy = $state(false);

  async function add(e: Event) {
    const files = Array.from((e.target as HTMLInputElement).files ?? []);
    if (!files.length) return;
    busy = true;
    try {
      for (const f of files) {
        const { blob, width, height } = await compressPhoto(f);
        await db.photos.put({ ...meta(), surveyId, ownerKind, ownerId, blob, width, height });
      }
      toast(files.length === 1 ? 'Снимката е запазена.' : `${files.length} снимки са запазени.`);
    } catch (err) {
      toast((err as Error).message || 'Снимката не можа да се запази.');
    } finally {
      busy = false;
      input.value = '';
    }
  }

  function show(p: Photo) {
    current = p;
    viewer.showModal();
  }

  async function remove() {
    if (!current || !confirm('Да изтрия ли снимката?')) return;
    await db.photos.delete(current.id);
    viewer.close();
  }
</script>

<div class="photos">
  {#each photos.value ?? [] as p (p.id)}
    <button type="button" class="thumb" onclick={() => show(p)} aria-label="Отвори снимката">
      <img src={urls[p.id]} alt="" />
    </button>
  {/each}
  <button type="button" class="add" onclick={() => input.click()} disabled={busy}>
    <Icon name="camera" size={20} stroke="#C2410C" />{busy ? '…' : 'Снимка'}
  </button>
  <input bind:this={input} type="file" accept="image/*" capture="environment" multiple hidden onchange={add} />
</div>

<dialog class="viewer" bind:this={viewer} onclose={() => (current = null)}>
  {#if current}
    <img src={urls[current.id]} alt="Снимка" />
    <div style="display: flex; gap: 8px; padding: 8px; background: #13232B">
      <button class="btn small danger" type="button" onclick={remove} style="background: #fff">Изтрий</button>
      <button class="btn small" type="button" onclick={() => viewer.close()}>Затвори</button>
    </div>
  {/if}
</dialog>
