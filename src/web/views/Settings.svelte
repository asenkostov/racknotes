<script lang="ts">
  import { exportBackup, importBackup } from '../lib/backup.ts';
  import { setAuthor, toast, ui } from '../lib/ui.svelte.ts';
  import Icon from '../lib/Icon.svelte';

  let author = $state(ui.author);
  let usage = $state('');
  let fileInput: HTMLInputElement;

  navigator.storage?.estimate?.().then(e => {
    if (e.usage !== undefined) usage = `${(e.usage / 1024 / 1024).toFixed(1)} MB използвани`;
  });

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
    if (!file || !confirm('Записите от архива ще се добавят; записи със същия идентификатор ще бъдат заменени. Продължаваш ли?')) return;
    try {
      toast(`Възстановени ${await importBackup(file)} записа.`);
    } catch (err) {
      toast((err as Error).message);
    }
  }
</script>

<header class="topbar">
  <div class="row" style="justify-content: flex-start">
    <a class="icon-btn" href="#/" aria-label="Назад" style="margin-left: -10px"><Icon name="back" /></a>
    <div class="title">Настройки</div>
  </div>
</header>

<main>
  <form class="stack card" onsubmit={e => { e.preventDefault(); setAuthor(author); toast('Запазено.'); }}>
    <div class="field"><label for="au">Име на описващия (по подразбиране в нов оглед)</label><input id="au" bind:value={author} /></div>
    <button class="btn small" type="submit" style="align-self: flex-start">Запази</button>
  </form>

  <div class="card">
    <h2 style="font-size: 16px">Архив</h2>
    <p class="muted" style="margin: 0">Данните се пазят само на това устройство, докато не е готова синхронизацията. Изтегляй архив след всеки оглед.</p>
    <div style="display: flex; gap: 8px; flex-wrap: wrap">
      <button class="btn small dark" onclick={download}>Изтегли архив (JSON)</button>
      <button class="btn small" onclick={() => fileInput.click()}>Възстанови от архив</button>
      <input bind:this={fileInput} type="file" accept="application/json,.json" hidden onchange={restore} />
    </div>
    {#if usage}<p class="muted" style="margin: 0">{usage}</p>{/if}
  </div>

  <div class="card">
    <h2 style="font-size: 16px">За приложението</h2>
    <p class="muted" style="margin: 0">RackNotes {__APP_VERSION__} · етап 1: теренен опис без връзка. Следват синхронизация на екипа, каталог от NetBox и експорт.</p>
    <a href="https://github.com/asenkostov/racknotes" target="_blank" rel="noopener">github.com/asenkostov/racknotes</a>
  </div>
</main>
