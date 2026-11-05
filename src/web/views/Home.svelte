<script lang="ts">
  import type { Survey } from '../../core/model.ts';
  import { meta } from '../../core/model.ts';
  import { db, save } from '../lib/db.ts';
  import { live } from '../lib/live.svelte.ts';
  import { go } from '../lib/router.svelte.ts';
  import { setAuthor, ui } from '../lib/ui.svelte.ts';
  import { plural, statusLabel } from '../lib/labels.ts';
  import Icon from '../lib/Icon.svelte';
  import Sheet from '../lib/Sheet.svelte';
  import Status from '../lib/Status.svelte';

  const surveys = live(
    () => 0,
    async () => {
      const list = await db.surveys.orderBy('updatedAt').reverse().toArray();
      return Promise.all(
        list.map(async s => ({
          s,
          racks: await db.racks.where('surveyId').equals(s.id).count(),
          devices: await db.devices.where('surveyId').equals(s.id).count(),
          check: await db.devices.where('surveyId').equals(s.id).filter(d => d.status === 'check').count()
        }))
      );
    }
  );

  let open = $state(false);
  let form = $state({ tenant: '', site: '', building: '', author: ui.author });
  let error = $state('');

  async function create(e: SubmitEvent) {
    e.preventDefault();
    if (!form.tenant.trim() || !form.site.trim()) return (error = 'Клиентът и обектът са задължителни.');
    setAuthor(form.author);
    const s: Survey = {
      ...meta(),
      tenant: form.tenant.trim(),
      site: form.site.trim(),
      building: form.building.trim(),
      author: form.author.trim(),
      status: 'in_progress',
      notes: ''
    };
    await save('surveys', s);
    open = false;
    go('/s/' + s.id);
  }

  const when = (iso: string) =>
    new Date(iso).toLocaleString('bg-BG', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
</script>

<header class="topbar">
  <div class="row">
    <span class="brand"><Icon name="logo" size={26} stroke="#F08A4B" /> RackNotes</span>
    <div style="display: flex; align-items: center; gap: 4px">
      <Status />
      <a class="icon-btn" href="#/settings" aria-label="Настройки"><Icon name="settings" /></a>
    </div>
  </div>
  <div class="sub">Теренен опис · експорт към NetBox 4.1.11</div>
</header>

<main>
  <button class="btn primary block" style="height: 56px; font-size: 17px" onclick={() => { form = { tenant: '', site: '', building: '', author: ui.author }; error = ''; open = true; }}>
    <Icon name="plus" size={20} /> Нов оглед
  </button>

  <div class="section-title">Огледи</div>
  {#if surveys.loaded && !surveys.value?.length}
    <div class="empty">Още няма огледи. Започни с „Нов оглед“.</div>
  {/if}
  {#each surveys.value ?? [] as row (row.s.id)}
    <a class="card" href={'#/s/' + row.s.id}>
      <div style="display: flex; justify-content: space-between; align-items: center">
        <span class="tag {row.s.status}">{statusLabel[row.s.status]}</span>
        <span class="muted">{when(row.s.updatedAt)}</span>
      </div>
      <div>
        <div style="font-size: 18px; font-weight: 600">{row.s.tenant}</div>
        <div class="muted">{row.s.site}{row.s.building ? ' · ' + row.s.building : ''}</div>
      </div>
      <div class="muted" style="display: flex; gap: 16px; flex-wrap: wrap">
        <span>{plural(row.racks, 'шкаф', 'шкафа')}</span>
        <span>{plural(row.devices, 'устройство', 'устройства')}</span>
        {#if row.check}<span><b style="color: var(--accent-ink)">{row.check}</b> за проверка</span>{/if}
      </div>
    </a>
  {/each}
</main>

<Sheet bind:open title="Нов оглед">
  <form class="stack" onsubmit={create}>
    <div class="field"><label for="t">Клиент (NetBox Tenant)</label><input id="t" bind:value={form.tenant} autocomplete="off" required /></div>
    <div class="field"><label for="s">Обект (NetBox Site)</label><input id="s" bind:value={form.site} autocomplete="off" required /></div>
    <div class="field"><label for="b">Сграда</label><input id="b" bind:value={form.building} autocomplete="off" /></div>
    <div class="field"><label for="a">Огледът се прави от</label><input id="a" bind:value={form.author} autocomplete="name" /></div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="btn primary block" type="submit">Започни оглед</button>
  </form>
</Sheet>
