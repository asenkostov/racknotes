<script lang="ts">
  import type { Facing, RoomItem } from '../../core/model.ts';
  import { ITEM_DEFS, itemBox, itemName, itemSize } from '../../core/plan.ts';
  import Photos from './Photos.svelte';

  let {
    item,
    surveyId,
    onchange,
    onnudge,
    ondelete
  }: {
    item: RoomItem;
    surveyId: string;
    onchange: (patch: Partial<RoomItem>) => void;
    onnudge: (dx: number, dy: number) => void;
    ondelete: () => void;
  } = $props();

  const def = $derived(ITEM_DEFS[item.kind]);
  const box = $derived(itemBox(item));
  const size = $derived(itemSize(item));
  const m = (v: number) => v.toFixed(2).replace('.', ',');
  const num = (v: string) => Number(String(v).replace(',', '.'));
</script>

<div class="card">
  <div style="display: flex; gap: 10px; align-items: center">
    <span class="sym" style="background: {def.color}">{def.sym || '▦'}</span>
    <h2 style="font-size: 18px">{itemName(item)}</h2>
  </div>
  {#if def.subs}
    <div class="field">
      <label for="it-sub">Вид</label>
      <select id="it-sub" value={item.sub ?? ''} onchange={e => onchange({ sub: (e.target as HTMLSelectElement).value || undefined, widthMm: undefined, depthMm: undefined })}>
        <option value="">не е отбелязано</option>
        {#each Object.entries(def.subs) as [k, v]}<option value={k}>{v}</option>{/each}
      </select>
    </div>
  {/if}
  <div class="field">
    <label for="it-name">{item.kind === 'note' ? 'Заглавие' : 'Име / модел'}</label>
    <input id="it-name" value={item.name ?? ''} placeholder={def.label} onchange={e => onchange({ name: (e.target as HTMLInputElement).value.trim() || undefined })} />
  </div>
  <div class="field">
    <label for="it-notes">Бележки</label>
    <textarea id="it-notes" rows="3" value={item.notes ?? ''} onchange={e => onchange({ notes: (e.target as HTMLTextAreaElement).value.trim() || undefined })}></textarea>
  </div>
  <div class="grid2">
    {#if box}
      <div class="field"><label for="it-w">Ширина (mm)</label><input id="it-w" class="mono" inputmode="numeric" value={Math.round(size.w * 1000)} onchange={e => { const v = Math.round(num((e.target as HTMLInputElement).value)); if (v >= 100 && v <= 10000) onchange({ widthMm: v }); }} /></div>
      <div class="field"><label for="it-d">Дълбочина (mm)</label><input id="it-d" class="mono" inputmode="numeric" value={Math.round(size.d * 1000)} onchange={e => { const v = Math.round(num((e.target as HTMLInputElement).value)); if (v >= 100 && v <= 10000) onchange({ depthMm: v }); }} /></div>
    {/if}
    <div class="field"><label for="it-x">От лявата стена (m)</label><input id="it-x" class="mono" inputmode="decimal" value={m(item.x)} onchange={e => { const v = num((e.target as HTMLInputElement).value); if (v >= 0) onchange({ x: v }); }} /></div>
    <div class="field"><label for="it-y">От горната стена (m)</label><input id="it-y" class="mono" inputmode="decimal" value={m(item.y)} onchange={e => { const v = num((e.target as HTMLInputElement).value); if (v >= 0) onchange({ y: v }); }} /></div>
  </div>
  {#if box && item.kind !== 'column'}
    <div class="field">
      <span style="font-size: 13px; font-weight: 600; color: var(--muted)">Лицето гледа към</span>
      <div class="seg4" role="group" aria-label="Посока на лицето">
        {#each [['up', '↑ горе'], ['right', '→ дясно'], ['down', '↓ долу'], ['left', '← ляво']] as [k, label]}
          <button class="btn small" class:dark={(item.facing ?? 'down') === k} aria-pressed={(item.facing ?? 'down') === k} onclick={() => onchange({ facing: k as Facing })}>{label}</button>
        {/each}
      </div>
    </div>
  {/if}
  <div class="field">
    <span style="font-size: 13px; font-weight: 600; color: var(--muted)">Премести с 10 cm</span>
    <div class="nudge">
      <span></span><button class="btn small" aria-label="Нагоре" onclick={() => onnudge(0, -0.1)}>↑</button><span></span>
      <button class="btn small" aria-label="Наляво" onclick={() => onnudge(-0.1, 0)}>←</button>
      <button class="btn small" aria-label="Надолу" onclick={() => onnudge(0, 0.1)}>↓</button>
      <button class="btn small" aria-label="Надясно" onclick={() => onnudge(0.1, 0)}>→</button>
    </div>
  </div>
  <Photos {surveyId} ownerKind="item" ownerId={item.id} />
  <button class="btn small danger" style="align-self: flex-start" onclick={ondelete}>Изтрий обекта</button>
</div>

<style>
  .sym { min-width: 34px; height: 28px; border-radius: 6px; color: #fff; font: 600 12px var(--mono); display: grid; place-items: center; padding: 0 6px; }
  .seg4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
  .seg4 .btn { padding: 0 4px; font-size: 13px; }
  .nudge { display: grid; grid-template-columns: repeat(3, 56px); gap: 6px; }
  .nudge .btn { height: 44px; font-size: 18px; }
  textarea { font: inherit; }
</style>
