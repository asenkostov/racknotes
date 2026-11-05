<script lang="ts">
  import type { Conflict } from '../lib/db.ts';
  import { db } from '../lib/db.ts';
  import { exportBackup, importBackup } from '../lib/backup.ts';
  import { live } from '../lib/live.svelte.ts';
  import { keepMine, sync, syncNow, takeServer } from '../lib/sync.svelte.ts';
  import { setAuthor, toast, ui } from '../lib/ui.svelte.ts';
  import Icon from '../lib/Icon.svelte';

  let author = $state(ui.author);
  let usage = $state('');
  let fileInput: HTMLInputElement;

  navigator.storage?.estimate?.().then(e => {
    if (e.usage !== undefined) usage = `${(e.usage / 1024 / 1024).toFixed(1)} MB използвани`;
  });

  const tableLabel: Record<string, string> = {
    surveys: 'Оглед',
    floors: 'Етаж',
    rooms: 'Помещение',
    racks: 'Шкаф',
    devices: 'Устройство',
    photos: 'Снимка'
  };
  const fieldLabel: Record<string, string> = {
    name: 'име', model: 'модел', manufacturer: 'производител', role: 'роля', position: 'позиция', uHeight: 'височина',
    face: 'страна', serial: 'сериен №', assetTag: 'инвентарен №', mgmtIp: 'IP', status: 'статус', notes: 'бележки',
    tenant: 'клиент', site: 'обект', building: 'сграда', fullDepth: 'дълбочина', level: 'етаж', roomId: 'помещение', rackId: 'шкаф'
  };
  const skip = new Set(['id', 'createdAt', 'updatedAt', 'version', 'blob', 'uploaded', 'surveyId']);

  const conflicts = live(
    () => sync.conflicts,
    async () =>
      Promise.all(
        (await db.conflicts.toArray()).map(async (c: Conflict) => {
          const local = (await db.table(c.table).get(c.id)) as Record<string, unknown> | undefined;
          const server = c.server.data ?? {};
          const title = String(local?.name || local?.model || local?.tenant || server.name || server.model || server.tenant || c.id.slice(0, 8));
          const diffs = local
            ? [...new Set([...Object.keys(local), ...Object.keys(server)])]
                .filter(k => !skip.has(k) && JSON.stringify(local[k] ?? '') !== JSON.stringify(server[k] ?? ''))
                .map(k => ({ field: fieldLabel[k] ?? k, mine: String(local[k] ?? '—'), theirs: String(server[k] ?? '—') }))
            : [];
          return { c, title, diffs, mineDeleted: !local, theirsDeleted: c.server.deleted };
        })
      )
  );

  async function download() {
    const blob = await exportBackup();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `racknotes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function restore(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    fileInput.value = '';
    if (!file || !confirm('Записите от архива ще се добавят и ще се синхронизират; записи със същия идентификатор ще бъдат заменени. Продължаваш ли?')) return;
    try {
      toast(`Възстановени ${await importBackup(file)} записа.`);
    } catch (err) {
      toast((err as Error).message);
    }
  }

  const stateText = $derived(
    {
      idle: sync.lastSync ? 'Синхронизирано в ' + new Date(sync.lastSync).toLocaleTimeString('bg-BG') : 'Готово',
      syncing: 'Синхронизира…',
      offline: 'Няма връзка — промените чакат на устройството.',
      auth: 'Сесията за вход е изтекла. Презареди страницата и влез отново.',
      error: 'Грешка: ' + sync.error,
      unavailable: 'Сървърът не е наличен (локален режим).'
    }[sync.state]
  );
</script>

<header class="topbar">
  <div class="row" style="justify-content: flex-start">
    <a class="icon-btn" href="#/" aria-label="Назад" style="margin-left: -10px"><Icon name="back" /></a>
    <div class="title">Настройки</div>
  </div>
</header>

<main>
  <div class="card">
    <h2 style="font-size: 16px">Синхронизация</h2>
    <p class="muted" style="margin: 0">{stateText}</p>
    <p class="muted" style="margin: 0">{sync.pending} промени чакат изпращане{sync.conflicts ? ` · ${sync.conflicts} конфликта` : ''}.</p>
    {#if sync.state === 'error' && sync.error}<p class="error" style="margin: 0">{sync.error}</p>{/if}
    <button class="btn small dark" style="align-self: flex-start" onclick={() => syncNow()} disabled={sync.state === 'syncing'}>Синхронизирай сега</button>
  </div>

  {#if conflicts.value?.length}
    <div class="section-title">Конфликти</div>
    {#each conflicts.value as k (k.c.table + k.c.id)}
      <div class="card">
        <div style="display: flex; justify-content: space-between; gap: 8px">
          <b>{tableLabel[k.c.table]} · {k.title}</b>
          <span class="muted" style="font-size: 12px">от {k.c.server.updatedBy}</span>
        </div>
        {#if k.mineDeleted}<p class="muted" style="margin: 0">Ти го изтри, а {k.c.server.updatedBy} го промени.</p>
        {:else if k.theirsDeleted}<p class="muted" style="margin: 0">Ти го промени, а {k.c.server.updatedBy} го изтри.</p>
        {:else}
          <div style="display: grid; grid-template-columns: auto 1fr 1fr; gap: 4px 10px; font-size: 14px">
            <span class="muted">поле</span><span class="muted">моето</span><span class="muted">тяхното</span>
            {#each k.diffs as d}<span>{d.field}</span><span class="mono">{d.mine}</span><span class="mono">{d.theirs}</span>{/each}
          </div>
        {/if}
        <div style="display: flex; gap: 8px; flex-wrap: wrap">
          <button class="btn small dark" onclick={() => keepMine(k.c.table, k.c.id)}>Запази моето</button>
          <button class="btn small" onclick={() => takeServer(k.c.table, k.c.id)}>Вземи тяхното</button>
        </div>
      </div>
    {/each}
  {/if}

  <form class="stack card" onsubmit={e => { e.preventDefault(); setAuthor(author); toast('Запазено.'); }}>
    <div class="field"><label for="au">Име на описващия (по подразбиране в нов оглед)</label><input id="au" bind:value={author} /></div>
    <button class="btn small" type="submit" style="align-self: flex-start">Запази</button>
  </form>

  <div class="card">
    <h2 style="font-size: 16px">Архив</h2>
    <p class="muted" style="margin: 0">Пълно копие на данните на това устройство, със снимките. Полезно преди смяна на телефон.</p>
    <div style="display: flex; gap: 8px; flex-wrap: wrap">
      <button class="btn small dark" onclick={download}>Изтегли архив (JSON)</button>
      <button class="btn small" onclick={() => fileInput.click()}>Възстанови от архив</button>
      <input bind:this={fileInput} type="file" accept="application/json,.json" hidden onchange={restore} />
    </div>
    {#if usage}<p class="muted" style="margin: 0">{usage}</p>{/if}
  </div>

  <div class="card">
    <h2 style="font-size: 16px">За приложението</h2>
    <p class="muted" style="margin: 0">RackNotes {__APP_VERSION__} · етап 2: синхронизация на екипа. Следват каталог от NetBox и експорт.</p>
    <a href="https://github.com/asenkostov/racknotes" target="_blank" rel="noopener">github.com/asenkostov/racknotes</a>
  </div>
</main>
