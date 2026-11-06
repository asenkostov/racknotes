<script lang="ts">
  import type { ImportPlan, NetboxFile } from '../../core/netbox.ts';
  import { buildImport, classify } from '../../core/netbox.ts';
  import { db, saveMany } from '../lib/db.ts';
  import { importBackup, inspectBackup } from '../lib/backup.ts';
  import { go } from '../lib/router.svelte.ts';
  import { toast, ui } from '../lib/ui.svelte.ts';
  import Icon from '../lib/Icon.svelte';

  const kindLabel: Record<string, string> = {
    racks: 'Шкафове',
    devices: 'Устройства',
    'device-types': 'Типове устройства',
    'device-roles': 'Роли (цветове)',
    cables: 'Кабели',
    'power-feeds': 'Захранващи линии',
    interfaces: 'Интерфейси (засега не се ползват)',
    locations: 'Locations',
    unknown: 'Непознат файл'
  };

  let files = $state<(NetboxFile & { name: string })[]>([]);
  let errors = $state<string[]>([]);
  let plan = $state<ImportPlan | null>(null);
  let planError = $state('');
  let existing = $state(false);
  let busy = $state(false);
  let input: HTMLInputElement;

  // A RackNotes file (survey export or full backup) is restored as is, not mapped.
  let restore = $state<{ file: File; info: NonNullable<Awaited<ReturnType<typeof inspectBackup>>> } | null>(null);

  async function pick(e: Event) {
    const list = Array.from((e.target as HTMLInputElement).files ?? []);
    input.value = '';
    for (const f of list) {
      try {
        const info = await inspectBackup(f).catch(() => null);
        if (info) {
          restore = { file: f, info };
          continue;
        }
        const nf = { ...classify(JSON.parse(await f.text())), name: f.name };
        files = [...files.filter(x => x.kind !== nf.kind || nf.kind === 'unknown'), nf];
      } catch (err) {
        errors = [...errors, `${f.name}: ${(err as Error).message}`];
      }
    }
    await rebuild();
  }

  async function rebuild() {
    plan = null;
    planError = '';
    if (!files.some(f => f.kind === 'racks')) return;
    try {
      plan = buildImport(files, { author: ui.author, now: new Date().toISOString() });
      existing = !!(await db.surveys.get(plan.survey.id));
    } catch (err) {
      planError = (err as Error).message;
    }
  }

  async function doRestore() {
    if (!restore) return;
    busy = true;
    try {
      const n = await importBackup(restore.file);
      toast(`Възстановени ${n} записа.`);
      go('/');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      busy = false;
    }
  }

  function remove(i: number) {
    files = files.filter((_, j) => j !== i);
    rebuild();
  }

  async function run() {
    if (!plan) return;
    busy = true;
    try {
      const p = $state.snapshot(plan);
      await saveMany([
        { table: 'surveys', rows: [p.survey] },
        { table: 'floors', rows: p.floors },
        { table: 'rooms', rows: p.rooms },
        { table: 'racks', rows: p.racks },
        { table: 'devices', rows: p.devices },
        { table: 'cables', rows: p.cables }
      ]);
      toast(`Внесени: ${p.racks.length} шкафа, ${p.devices.length} устройства, ${p.cables.length} кабела.`);
      go('/s/' + p.survey.id);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      busy = false;
    }
  }

  const perRack = $derived(
    plan?.racks.map(r => ({
      r,
      inRack: plan!.devices.filter(d => d.rackId === r.id && !d.parentId).length,
      children: plan!.devices.filter(d => d.rackId === r.id && d.parentId).length
    })) ?? []
  );
</script>

<header class="topbar">
  <div class="row" style="justify-content: flex-start">
    <a class="icon-btn" href="#/" aria-label="Назад" style="margin-left: -10px"><Icon name="back" /></a>
    <div class="title">Внос от NetBox</div>
  </div>
  <div class="sub">JSON файлове, запазени от NetBox API (format=json)</div>
</header>

<main>
  <div class="card">
    <p class="muted" style="margin: 0">Тук се зарежда и файл, изтеглен от RackNotes (оглед или архив). За NetBox са нужни <b>шкафовете</b>; препоръчително и <b>устройствата</b>, <b>типовете устройства</b> и <b>кабелите</b>. Захранващите линии дават имената на захранването, ролите — цветовете в шкафа. Файловете се разпознават сами — може да ги избереш наведнъж.</p>
    <button class="btn dark" onclick={() => input.click()}><Icon name="plus" size={18} /> Избери файлове</button>
    <input bind:this={input} type="file" accept=".json,.txt,application/json,text/plain" multiple hidden onchange={pick} />
  </div>

  {#if restore}
    <div class="card">
      <h2 style="font-size: 17px">Файл от RackNotes</h2>
      <p class="muted" style="margin: 0">{restore.info.scope === 'survey' ? 'Оглед' : 'Пълен архив'}{restore.info.exportedAt ? ' · изтеглен ' + new Date(restore.info.exportedAt).toLocaleString('bg-BG') : ''}</p>
      {#each restore.info.surveys as s}<b>{s}</b>{/each}
      <p class="muted" style="margin: 0">{restore.info.counts.racks} шкафа · {restore.info.counts.devices} устройства · {restore.info.counts.cables} кабела · {restore.info.counts.photos} снимки</p>
      <div style="display: flex; gap: 8px">
        <button class="btn primary" onclick={doRestore} disabled={busy}>{busy ? 'Възстановява…' : 'Възстанови'}</button>
        <button class="btn" onclick={() => (restore = null)}>Отказ</button>
      </div>
    </div>
  {/if}

  {#if files.length}
    <div class="list">
      {#each files as f, i (f.name + i)}
        <div>
          <span>
            <b>{kindLabel[f.kind]}</b> · {f.results.length}{f.complete ? '' : ` от ${f.count} — непълен`}<br />
            <span class="muted mono" style="font-size: 12px">{f.name}</span>
          </span>
          <button class="icon-btn" aria-label="Премахни {f.name}" onclick={() => remove(i)} style="color: var(--muted)"><Icon name="close" size={18} /></button>
        </div>
      {/each}
    </div>
  {/if}

  {#each errors as e}<p class="error" style="margin: 0">{e}</p>{/each}
  {#if planError}<p class="error" style="margin: 0">{planError}</p>{/if}
  {#if files.length && !files.some(f => f.kind === 'racks')}<p class="muted" style="margin: 0">Добави и файла с шкафовете (dcim/racks).</p>{/if}

  {#if plan}
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center">
        <h2 style="font-size: 17px">{plan.survey.tenant} · {plan.survey.site}</h2>
        <span class="tag imported">В NETBOX</span>
      </div>
      {#each perRack as x (x.r.id)}
        <div style="display: flex; justify-content: space-between; font-size: 15px">
          <span><b>{x.r.name}</b> <span class="muted">· {x.r.uHeight}U</span></span>
          <span class="muted">{x.inRack} в шкафа{x.children ? ` + ${x.children} в шаси` : ''}</span>
        </div>
      {/each}
      <div class="muted">
        Кабели: {plan.cables.filter(c => c.type === 'data').length} за данни, {plan.cables.filter(c => c.type === 'power').length} захранващи
        {plan.skipped.devices ? ` · ${plan.skipped.devices} устройства извън тези шкафове са пропуснати` : ''}
        {plan.skipped.cables ? ` · ${plan.skipped.cables} кабела без връзка с тези устройства` : ''}
      </div>
      {#if existing}<p class="muted" style="margin: 0">Този обект вече е внесен на това устройство. Записите ще се обновят; ако някой ги е променял междувременно, ще видиш конфликт за всеки от тях.</p>{/if}
    </div>

    {#if plan.warnings.length}
      <div class="card">
        <h3 style="font-size: 15px">Предупреждения ({plan.warnings.length})</h3>
        {#each plan.warnings.slice(0, 20) as w}<span style="font-size: 14px">• {w}</span>{/each}
        {#if plan.warnings.length > 20}<span class="muted">… и още {plan.warnings.length - 20}</span>{/if}
      </div>
    {/if}
  {/if}
</main>

{#if plan}
  <div class="footer-actions">
    <div class="inner">
      <button class="btn primary" onclick={run} disabled={busy}>{busy ? 'Внася…' : existing ? 'Обнови от NetBox' : 'Внеси като оглед'}</button>
    </div>
  </div>
{/if}
