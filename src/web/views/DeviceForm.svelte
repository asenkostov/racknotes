<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { Device, Face, VerifyStatus } from '../../core/model.ts';
  import { meta, now } from '../../core/model.ts';
  import { norm, ref, type CatalogType } from '../../core/catalog.ts';
  import { catalog, imgUrl, loadCatalog } from '../lib/catalog.svelte.ts';
  import { fittingPositions, placementError, uLabel } from '../../core/rack.ts';
  import { db, deleteDevice, discardPhotos, save } from '../lib/db.ts';
  import { live } from '../lib/live.svelte.ts';
  import { go } from '../lib/router.svelte.ts';
  import { toast } from '../lib/ui.svelte.ts';
  import Icon from '../lib/Icon.svelte';
  import Photos from '../lib/Photos.svelte';

  let { id, params }: { id: string; params: URLSearchParams } = $props();
  const isNew = untrack(() => id === 'new');
  let saved = false;

  // Form state; for a new device the id exists from the start so photos can attach to it.
  let form = $state<Device | null>(null);
  let error = $state('');

  const ctx = live(
    () => (isNew ? params.get('rack') ?? '' : id),
    async key => {
      const existing = isNew ? undefined : await db.devices.get(key);
      const rackId = existing?.rackId ?? key;
      const rack = await db.racks.get(rackId);
      if (!rack) return null;
      const [others, all] = await Promise.all([
        db.devices.where('rackId').equals(rackId).toArray(),
        db.devices.toArray()
      ]);
      return { existing, rack, others, all };
    }
  );

  // Initialise the form once, when the context first arrives.
  $effect(() => {
    const c = ctx.value;
    if (!c || form) return;
    if (c.existing) {
      form = { ...c.existing };
      return;
    }
    const top = Number(params.get('top') ?? 0);
    const face = (params.get('face') === 'rear' ? 'rear' : 'front') as Face;
    form = {
      ...meta(),
      surveyId: c.rack.surveyId,
      rackId: c.rack.id,
      name: '',
      manufacturer: '',
      model: '',
      role: '',
      uHeight: 1,
      position: top > 0 ? top : 0,
      face,
      fullDepth: true,
      serial: '',
      assetTag: '',
      mgmtIp: '',
      status: 'check',
      notes: ''
    };
  });

  // Local catalog (until the NetBox catalog arrives in milestone 3): values used before.
  const distinct = (pick: (d: Device) => string) =>
    [...new Set((ctx.value?.all ?? []).map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'bg'));
  const manufacturers = $derived(distinct(d => d.manufacturer));
  const models = $derived(distinct(d => d.model));
  const roles = $derived(distinct(d => d.role));

  // --- device type library: suggestions while typing, link on pick ---
  loadCatalog();
  const makerList = $derived([...new Set([...manufacturers, ...(catalog.cat?.makers ?? [])])]);
  let suggestOpen = $state(false);
  const suggestions = $derived(suggestOpen && form && catalog.cat ? catalog.cat.search(form.manufacturer, form.model, 6) : []);
  const linked = $derived(form?.catalog ? catalog.cat?.get(form.catalog.slug) : undefined);

  function pick(t: CatalogType) {
    if (!form) return;
    form.manufacturer = t.manufacturer;
    form.model = t.model;
    form.catalog = ref(t);
    if (t.uHeight >= 1) form.uHeight = Math.ceil(t.uHeight);
    else form.position = 0; // 0U: vertical PDUs and the like
    form.fullDepth = t.fullDepth;
    suggestOpen = false;
  }
  function unlink() {
    if (form) delete form.catalog;
  }
  function modelTyped() {
    suggestOpen = true;
    // Editing the model away from the linked type drops the link.
    if (form?.catalog && linked && ![norm(linked.model), norm(linked.part)].includes(norm(form.model))) delete form.catalog;
  }

  function modelChosen() {
    if (!form) return;
    const prev = ctx.value?.all.find(d => d.model === form!.model && d.id !== form!.id);
    if (!prev) return;
    if (!form.manufacturer) form.manufacturer = prev.manufacturer;
    if (!form.role) form.role = prev.role;
    if (isNew) {
      form.uHeight = prev.uHeight;
      form.fullDepth = prev.fullDepth;
    }
  }

  const others = $derived((ctx.value?.others ?? []).filter(d => d.id !== form?.id));
  const positions = $derived(
    form && ctx.value ? fittingPositions(ctx.value.rack.uHeight, others, form.face, Math.max(1, Number(form.uHeight) || 1), form.id) : []
  );

  // Keep the chosen position valid when height/face changes: snap to the nearest fitting slot.
  $effect(() => {
    if (!form || form.position === 0 || !positions.length) return;
    const pos = untrack(() => form!.position);
    if (!positions.includes(pos)) {
      const nearest = positions.reduce((a, b) => (Math.abs(b - pos) < Math.abs(a - pos) ? b : a));
      untrack(() => (form!.position = nearest));
    }
  });

  async function submit(status: VerifyStatus) {
    if (!form || !ctx.value) return;
    error = '';
    const d: Device = {
      ...$state.snapshot(form),
      uHeight: Math.trunc(Number(form.uHeight)),
      position: Math.trunc(Number(form.position)),
      name: form.name.trim(),
      model: form.model.trim(),
      manufacturer: form.manufacturer.trim(),
      role: form.role.trim(),
      serial: form.serial.trim(),
      assetTag: form.assetTag.trim(),
      mgmtIp: form.mgmtIp.trim(),
      status
    };
    if (!d.name && !d.model) return (error = 'Въведи поне име или модел.');
    if (!d.catalog && catalog.cat) {
      const t = catalog.cat.exact(d.manufacturer, d.model, d.typeSlug);
      if (t) d.catalog = ref(t);
    }
    if (d.mgmtIp && !/^[0-9a-fA-F:.]+$/.test(d.mgmtIp)) return (error = 'IP адресът изглежда невалиден (без маска).');
    const err = placementError(ctx.value.rack.uHeight, others, d);
    if (err) return (error = err);
    await save('devices', d);
    saved = true;
    toast(isNew ? 'Устройството е добавено.' : 'Промените са запазени.');
    go('/r/' + d.rackId);
  }

  async function remove() {
    if (!form || !confirm(`Да изтрия ли ${form.name || form.model || 'устройството'}?`)) return;
    await deleteDevice(form.id);
    saved = true;
    go('/r/' + form.rackId);
  }

  // A new device that was never saved should not leave orphan photos behind.
  onDestroy(() => {
    if (isNew && !saved && form) discardPhotos('device', form.id);
  });

  // --- serial number from barcode (Chrome on Android; not available in iOS Safari) ---
  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  let scanInput = $state<HTMLInputElement>();
  async function scan(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (scanInput) scanInput.value = '';
    if (!file || !form) return;
    try {
      // @ts-expect-error BarcodeDetector is not in the TS DOM lib yet
      const detector = new window.BarcodeDetector();
      const codes: { rawValue: string }[] = await detector.detect(await createImageBitmap(file));
      if (!codes.length) return toast('Не открих баркод. Опитай по-отблизо и с повече светлина.');
      form.serial = codes[0].rawValue;
      toast('Серийният номер е прочетен — провери го.');
    } catch {
      toast('Сканирането не е налично на това устройство.');
    }
  }

  const stamp = (iso: string) => new Date(iso).toLocaleString('bg-BG');

  // Read-only context for an existing device: what it is installed in, what is installed in it, and its cables.
  const related = live(
    () => (isNew ? '' : id),
    async did => {
      if (!did) return null;
      const self = await db.devices.get(did);
      const [parent, children, a, b] = await Promise.all([
        self?.parentId ? db.devices.get(self.parentId) : undefined,
        db.devices.where('parentId').equals(did).sortBy('name'),
        db.cables.where('a.deviceId').equals(did).toArray(),
        db.cables.where('b.deviceId').equals(did).toArray()
      ]);
      const cables = [...a.map(c => ({ c, mine: c.a, other: c.b })), ...b.map(c => ({ c, mine: c.b, other: c.a }))];
      const otherIds = [...new Set(cables.map(x => x.other.deviceId).filter((v): v is string => !!v))];
      const names = new Map((await db.devices.bulkGet(otherIds)).filter(Boolean).map(d => [d!.id, d!.name || d!.model]));
      const rows = cables
        .map(x => ({
          id: x.c.id,
          label: x.c.label,
          power: x.c.type === 'power',
          port: x.mine.port,
          to: x.other.deviceId ? (names.get(x.other.deviceId) ?? 'изтрито устройство') : (x.other.external ?? '—'),
          toId: x.other.deviceId && names.has(x.other.deviceId) ? x.other.deviceId : '',
          toPort: x.other.port
        }))
        .sort((p, q) => Number(p.power) - Number(q.power) || p.port.localeCompare(q.port, 'en', { numeric: true }));
      return { parent, children, rows };
    }
  );
</script>

<header class="topbar">
  <div class="row" style="justify-content: flex-start">
    <a class="icon-btn" href={ctx.value ? '#/r/' + ctx.value.rack.id : '#/'} aria-label="Затвори" style="margin-left: -10px"><Icon name="close" /></a>
    <div>
      <div style="font-size: 18px; font-weight: 700">{isNew ? 'Ново устройство' : form?.name || form?.model || 'Устройство'}</div>
      {#if ctx.value}<div class="sub">{ctx.value.rack.name}{form?.position ? ' · ' + uLabel(form.position + form.uHeight - 1, form.position) : ' · без U позиция'}</div>{/if}
    </div>
  </div>
</header>

{#if ctx.loaded && !ctx.value}
  <main><div class="empty">Устройството или шкафът не са намерени.</div></main>
{:else if form && ctx.value}
  <main>
    <form class="stack" onsubmit={e => { e.preventDefault(); submit(form!.status); }}>
      <div class="grid2">
        <div class="field">
          <label for="mf">Производител</label>
          <input id="mf" list="mf-list" bind:value={form.manufacturer} autocomplete="off" />
          <datalist id="mf-list">{#each makerList as v}<option value={v}></option>{/each}</datalist>
        </div>
        <div class="field">
          <label for="md">Модел</label>
          <input id="md" list="md-list" bind:value={form.model} onchange={modelChosen} oninput={modelTyped} autocomplete="off" />
          <datalist id="md-list">{#each models as v}<option value={v}></option>{/each}</datalist>
        </div>
        {#if suggestions.length}
          <div class="suggest" role="listbox" aria-label="Модели от каталога">
            <div class="suggest-head">От каталога <button type="button" class="link" onclick={() => (suggestOpen = false)}>скрий</button></div>
            {#each suggestions as t (t.slug)}
              <button type="button" role="option" aria-selected="false" class="suggest-row" onclick={() => pick(t)}>
                <span class="thumb">{#if t.front}<img src={imgUrl(t.front)} alt="" loading="lazy" />{/if}</span>
                <span class="suggest-text">
                  <b>{t.model}</b>
                  <span class="muted">{t.manufacturer}{t.part !== t.model ? ' · ' + t.part : ''} · {t.uHeight ? t.uHeight + 'U' : '0U'}{t.front ? '' : ' · без изглед'}</span>
                </span>
              </button>
            {/each}
          </div>
        {/if}
        {#if form.catalog}
          <div class="linked">
            <div class="linked-imgs">
              {#if form.catalog.front}<img src={imgUrl(form.catalog.front)} alt="Отпред" />{/if}
              {#if form.catalog.rear}<img src={imgUrl(form.catalog.rear)} alt="Отзад" />{/if}
              {#if !form.catalog.front && !form.catalog.rear}<span class="muted" style="font-size: 13px">Моделът е в каталога, но няма изображение.</span>{/if}
            </div>
            <span class="muted" style="font-size: 13px">Свързано с каталога: <span class="mono">{form.catalog.slug}</span> · <button type="button" class="link" onclick={unlink}>откачи</button></span>
          </div>
        {/if}
        <div class="field"><label for="nm">Име (hostname)</label><input id="nm" class="mono" bind:value={form.name} autocomplete="off" autocapitalize="characters" /></div>
        <div class="field">
          <label for="rl">Роля</label>
          <input id="rl" list="rl-list" bind:value={form.role} autocomplete="off" />
          <datalist id="rl-list">{#each roles as v}<option value={v}></option>{/each}</datalist>
        </div>
        <div class="field"><label for="uh">Височина (U)</label><input id="uh" type="number" min="1" max="60" bind:value={form.uHeight} /></div>
        <div class="field">
          <label for="ps">Позиция</label>
          <select id="ps" bind:value={form.position}>
            <option value={0}>Без U (0U / рафт)</option>
            {#each positions as p}<option value={p}>{uLabel(p + Number(form.uHeight) - 1, p)}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="fc">Страна</label>
          <select id="fc" bind:value={form.face}><option value="front">Лице</option><option value="rear">Гръб</option></select>
        </div>
        <div class="field">
          <label for="fd">Дълбочина</label>
          <select id="fd" bind:value={form.fullDepth}><option value={true}>Пълна (заема и двете страни)</option><option value={false}>Половин</option></select>
        </div>
      </div>

      <div class="field">
        <label for="sn">Сериен номер</label>
        <div class="with-btn">
          <input id="sn" class="mono" bind:value={form.serial} autocomplete="off" autocapitalize="characters" style="flex: 1; min-width: 0" />
          {#if canScan}
            <button type="button" class="btn small" aria-label="Сканирай баркод" onclick={() => scanInput?.click()} style="height: 46px">▥ Скан</button>
            <input bind:this={scanInput} type="file" accept="image/*" capture="environment" hidden onchange={scan} />
          {/if}
        </div>
      </div>
      <div class="grid2">
        <div class="field"><label for="at">Инвентарен №</label><input id="at" class="mono" bind:value={form.assetTag} autocomplete="off" /></div>
        <div class="field"><label for="ip">IP за управление</label><input id="ip" class="mono" inputmode="decimal" bind:value={form.mgmtIp} autocomplete="off" placeholder="10.0.0.10" /></div>
      </div>
      <div class="field"><label for="nt">Бележки</label><textarea id="nt" bind:value={form.notes}></textarea></div>

      <div class="field">
        <span style="font-size: 13px; font-weight: 600; color: var(--muted)">Снимки (етикет, лице, гръб)</span>
        <Photos surveyId={form.surveyId} ownerKind="device" ownerId={form.id} />
      </div>

      {#if related.value?.parent}
        <p class="muted" style="margin: 0">Монтирано в <a href={'#/d/' + related.value.parent.id}>{related.value.parent.name}</a></p>
      {/if}
      {#if related.value?.children.length}
        <div class="field">
          <span style="font-size: 13px; font-weight: 600; color: var(--muted)">В шасито ({related.value.children.length})</span>
          <div class="list">
            {#each related.value.children as ch (ch.id)}
              <a href={'#/d/' + ch.id}><span><b>{ch.name}</b><br /><span class="muted">{ch.model}{ch.serial ? ' · ' + ch.serial : ''}</span></span><Icon name="chevron" size={16} /></a>
            {/each}
          </div>
        </div>
      {/if}
      {#if related.value?.rows.length}
        <div class="field">
          <span style="font-size: 13px; font-weight: 600; color: var(--muted)">Връзки ({related.value.rows.length})</span>
          <div class="list">
            {#each related.value.rows as r (r.id)}
              <div style="font-size: 14px">
                <span style="min-width: 0">
                  <span class="mono">{r.port}</span> → {#if r.toId}<a href={'#/d/' + r.toId}>{r.to}</a>{:else}{r.to}{/if} <span class="mono">{r.toPort}</span><br />
                  <span class="muted" style="font-size: 12px">{r.power ? 'захранване' : 'данни'} · {r.label}</span>
                </span>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if error}<p class="error" role="alert">{error}</p>{/if}
      {#if !isNew}
        <p class="muted">Създадено {stamp(form.createdAt)} · последна промяна {stamp(form.updatedAt ?? now())}</p>
        <button class="btn danger small" type="button" onclick={remove} style="align-self: flex-start"><Icon name="trash" size={18} /> Изтрий</button>
      {/if}
    </form>
  </main>

  <div class="footer-actions">
    <div class="inner">
      <button class="btn" type="button" onclick={() => submit('check')}>За проверка</button>
      <button class="btn dark" type="button" onclick={() => submit('confirmed')}>Потвърдено ✓</button>
    </div>
  </div>
{/if}

<style>
  .suggest, .linked { grid-column: 1 / -1; background: var(--card); border: 1px solid var(--field); border-radius: 10px; overflow: hidden; }
  .suggest-head { display: flex; justify-content: space-between; padding: 8px 12px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted); }
  .suggest-row { display: flex; gap: 10px; align-items: center; width: 100%; padding: 8px 12px; background: none; border: 0; border-top: 1px solid var(--line-2); text-align: left; cursor: pointer; min-height: 52px; }
  .suggest-row:hover { background: #f6f8f7; }
  .thumb { width: 96px; height: 22px; flex: none; background: #eef2f1; border-radius: 3px; overflow: hidden; display: block; }
  .thumb img { width: 100%; height: 100%; object-fit: fill; display: block; }
  .suggest-text { display: flex; flex-direction: column; min-width: 0; font-size: 14px; }
  .suggest-text b, .suggest-text span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .linked { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  .linked-imgs { display: flex; flex-direction: column; gap: 6px; }
  .linked-imgs img { width: 100%; max-height: 120px; object-fit: contain; background: #eef2f1; border-radius: 4px; }
  .link { background: none; border: 0; padding: 0; color: var(--accent-ink); font-weight: 600; cursor: pointer; text-decoration: underline; }
</style>
