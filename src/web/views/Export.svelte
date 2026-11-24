<script lang="ts">
  import { strToU8, zipSync } from 'fflate';
  import { buildExport, csv, readme, type CsvFile, type Known } from '../../core/export.ts';
  import { classify, type NetboxFile } from '../../core/netbox.ts';
  import { db, save } from '../lib/db.ts';
  import { live } from '../lib/live.svelte.ts';
  import { downloadBlob } from '../lib/backup.ts';
  import { catalog, loadCatalog } from '../lib/catalog.svelte.ts';
  import { addKnown, clearKnown, getKnown } from '../lib/known.ts';
  import { toast } from '../lib/ui.svelte.ts';
  import Icon from '../lib/Icon.svelte';

  let { id }: { id: string } = $props();

  const data = live(
    () => id,
    async sid => {
      const survey = await db.surveys.get(sid);
      if (!survey) return null;
      const [floors, rooms, racks, devices] = await Promise.all([
        db.floors.where('surveyId').equals(sid).toArray(),
        db.rooms.where('surveyId').equals(sid).sortBy('name'),
        db.racks.where('surveyId').equals(sid).sortBy('name'),
        db.devices.where('surveyId').equals(sid).toArray()
      ]);
      return { survey, floors, rooms, racks, devices };
    }
  );

  let known = $state<Known | null>(null);
  getKnown().then(k => (known = k));
  loadCatalog();

  // Catalog slugs and part numbers for linked device types, so NetBox gets the library's slug.
  const typeInfo = $derived.by(() => {
    const m = new Map<string, { slug: string; part?: string }>();
    for (const d of data.value?.devices ?? []) {
      const t = d.catalog && catalog.cat?.get(d.catalog.slug);
      if (t) m.set(`${d.manufacturer.trim()}\u0000${d.model.trim()}`, { slug: t.slug, part: t.part });
    }
    return m;
  });
  const result = $derived(data.value && known ? buildExport({ ...$state.snapshot(data.value), typeInfo }, known) : null);
  const knownCount = $derived(known ? known.deviceTypes.length + known.manufacturers.length + known.roles.length : 0);
  let open = $state<string | null>(null);

  function download() {
    const v = data.value;
    if (!v || !result) return;
    const when = new Date().toISOString();
    const files: Record<string, Uint8Array> = { 'README.txt': strToU8(readme(result, v.survey, when.slice(0, 16).replace('T', ' '))) };
    for (const f of result.files) files[f.name] = strToU8(csv(f));
    const zip = zipSync(files, { level: 6 });
    const name = `netbox-${v.survey.site || v.survey.tenant || 'obekt'}-${when.slice(0, 10)}.zip`.replace(/[^\p{L}\p{N}._-]+/gu, '-');
    downloadBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), name);
  }
  function downloadOne(f: CsvFile) {
    downloadBlob(new Blob([csv(f)], { type: 'text/csv;charset=utf-8' }), f.name);
  }

  let fileInput: HTMLInputElement | undefined = $state();
  async function loadNetbox(e: Event) {
    const list = [...((e.target as HTMLInputElement).files ?? [])];
    (e.target as HTMLInputElement).value = '';
    const parsed: NetboxFile[] = [];
    for (const f of list) {
      try {
        parsed.push(classify(JSON.parse(await f.text())));
      } catch {
        toast(`${f.name} не е JSON от NetBox.`);
      }
    }
    if (parsed.length) {
      known = await addKnown(parsed);
      toast('Списъкът с какво има в NetBox е обновен.');
    }
  }
  async function forget() {
    if (!confirm('Да забравя ли какво има в NetBox? Тогава експортът ще съдържа всички производители, роли и типове.')) return;
    await clearKnown();
    known = await getKnown();
  }
  async function markImported() {
    const s = data.value?.survey;
    if (!s || !confirm('Огледът е внесен в NetBox? Ще го отбележа като „В NetBox“.')) return;
    await save('surveys', $state.snapshot({ ...s, status: 'imported' as const }));
    toast('Отбелязан като внесен в NetBox.');
  }
  const preview = (f: CsvFile) => f.rows.slice(0, 50);
</script>

<header class="topbar">
  <div class="row">
    <a class="icon-btn" href={'#/s/' + id} aria-label="Назад към огледа" style="margin-left: -10px"><Icon name="back" /></a>
  </div>
  {#if data.value}
    <div>
      <div class="title">Експорт към NetBox</div>
      <div class="sub">{data.value.survey.tenant} · {data.value.survey.site} · NetBox 4.1.11</div>
    </div>
  {/if}
</header>

{#if data.loaded && !data.value}
  <main><div class="empty">Огледът не е намерен.</div></main>
{:else if data.value && result}
  <main>
    <div class="card">
      <p style="margin: 0">CSV файлове за <b>Import</b> в NetBox, по ред на номерата. Всеки файл се внася цял или никак — ако NetBox откаже ред, поправи и пусни файла пак.</p>
      {#if result.files.length}
        <button class="btn primary" onclick={download}>Изтегли ZIP ({result.files.length} файла + инструкции)</button>
      {:else}
        <p class="muted" style="margin: 0">Няма нищо ново или променено за NetBox.</p>
      {/if}
    </div>

    {#if result.warnings.length}
      <div class="card warn">
        <h3 style="font-size: 15px">Преди внасяне</h3>
        {#each result.warnings as w}<span style="font-size: 14px">⚠ {w}</span>{/each}
      </div>
    {/if}

    <div class="section-title">Файлове</div>
    <div class="list">
      {#each result.files as f (f.name)}
        <div class="file">
          <button class="file-head" onclick={() => (open = open === f.name ? null : f.name)} aria-expanded={open === f.name}>
            <span><b class="mono">{f.name}</b>{#if f.optional} <span class="tag check">по желание</span>{/if}<br /><span class="muted" style="font-size: 13px">{f.title} · {f.where}</span></span>
            <span class="count">{f.rows.length}</span>
          </button>
          {#if open === f.name}
            <div class="table-wrap">
              <table>
                <thead><tr>{#each f.header as h}<th>{h}</th>{/each}</tr></thead>
                <tbody>{#each preview(f) as r}<tr>{#each f.header as h}<td>{r[h] ?? ''}</td>{/each}</tr>{/each}</tbody>
              </table>
              {#if f.rows.length > 50}<p class="muted" style="font-size: 13px">… и още {f.rows.length - 50}</p>{/if}
            </div>
            <button class="btn small" style="align-self: flex-start" onclick={() => downloadOne(f)}>Изтегли само този файл</button>
          {/if}
        </div>
      {/each}
    </div>

    {#if result.missing.length}
      <div class="section-title">Липсват на място ({result.missing.length})</div>
      <div class="card">
        <p class="muted" style="margin: 0; font-size: 14px">В NetBox не се трият автоматично. Файлът „12-…offline“ ги маркира със статус offline, ако решиш да го внесеш.</p>
        {#each result.missing as d (d.id)}<span class="mono" style="font-size: 14px">✗ {d.name || d.model}</span>{/each}
      </div>
    {/if}

    <div class="card">
      <h3 style="font-size: 15px">Какво вече има в NetBox</h3>
      {#if knownCount}
        <p class="muted" style="margin: 0; font-size: 14px">
          От внесени файлове{known?.at ? ` (последно ${new Date(known.at).toLocaleDateString('bg-BG')})` : ''}: {known?.manufacturers.length} производителя, {known?.roles.length} роли, {known?.deviceTypes.length} типа, {known?.locations.length} помещения. Те не влизат във файловете.
        </p>
      {:else}
        <p style="margin: 0; font-size: 14px">⚠ Не знам какво има в NetBox — всички производители, роли и типове влизат във файловете и NetBox ще откаже тези, които вече съществуват. Зареди JSON от NetBox (device-types, device-roles, racks), за да ги махна.</p>
      {/if}
      <div style="display: flex; gap: 8px; flex-wrap: wrap">
        <button class="btn small" onclick={() => fileInput?.click()}>Зареди JSON от NetBox</button>
        {#if knownCount}<button class="btn small" onclick={forget}>Забрави</button>{/if}
      </div>
      <input bind:this={fileInput} type="file" accept=".json,application/json" multiple hidden onchange={loadNetbox} />
    </div>

    {#if data.value.survey.status !== 'imported'}
      <button class="btn small" style="align-self: flex-start" onclick={markImported}>Внесено е в NetBox — отбележи огледа</button>
    {/if}
  </main>
{/if}

<style>
  .warn { border: 2px solid #f08a4b; gap: 6px; }
  .file { display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--line-2); padding-bottom: 8px; }
  .file-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; width: 100%; background: none; border: 0; padding: 0; text-align: left; font: inherit; cursor: pointer; min-height: 48px; }
  .count { font: 600 18px var(--mono); min-width: 2ch; text-align: right; }
  .table-wrap { overflow-x: auto; max-height: 50dvh; border: 1px solid var(--line-2); border-radius: 8px; }
  table { border-collapse: collapse; font-size: 12px; font-family: var(--mono); }
  th, td { padding: 4px 8px; border-bottom: 1px solid var(--line-2); text-align: left; white-space: nowrap; max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
  th { position: sticky; top: 0; background: #eef2f1; }
</style>
