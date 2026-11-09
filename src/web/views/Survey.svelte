<script lang="ts">
  import type { Floor, Rack, Room, SurveyStatus } from '../../core/model.ts';
  import { meta } from '../../core/model.ts';
  import { usedUnits } from '../../core/rack.ts';
  import { db, deleteSurvey, save, saveMany } from '../lib/db.ts';
  import { live } from '../lib/live.svelte.ts';
  import { go } from '../lib/router.svelte.ts';
  import { toast } from '../lib/ui.svelte.ts';
  import { plural, statusLabel } from '../lib/labels.ts';
  import Icon from '../lib/Icon.svelte';
  import Sheet from '../lib/Sheet.svelte';
  import Status from '../lib/Status.svelte';
  import Photos from '../lib/Photos.svelte';
  import { downloadBlob, exportSurvey } from '../lib/backup.ts';
  import { autoLink, cacheImages } from '../lib/catalog.svelte.ts';

  let { id }: { id: string } = $props();

  const data = live(
    () => id,
    async sid => {
      const survey = await db.surveys.get(sid);
      if (!survey) return null;
      const [floors, rooms, racks, devices] = await Promise.all([
        db.floors.where('surveyId').equals(sid).sortBy('level'),
        db.rooms.where('surveyId').equals(sid).sortBy('name'),
        db.racks.where('surveyId').equals(sid).sortBy('name'),
        db.devices.where('surveyId').equals(sid).toArray()
      ]);
      return { survey, floors, rooms, racks, devices };
    }
  );

  const survey = $derived(data.value?.survey);
  const racksIn = (roomId: string) => data.value?.racks.filter(r => r.roomId === roomId) ?? [];
  const roomName = (roomId: string) => data.value?.rooms.find(r => r.id === roomId)?.name ?? '?';
  const devicesIn = (rackId: string) => data.value?.devices.filter(d => d.rackId === rackId) ?? [];

  // --- add room ---
  let roomOpen = $state(false);
  let roomForm = $state({ level: 1, room: '' });
  async function addRoom(e: SubmitEvent) {
    e.preventDefault();
    if (!survey || !roomForm.room.trim()) return;
    const level = Math.trunc(Number(roomForm.level) || 0);
    let floor = data.value!.floors.find(f => f.level === level);
    if (!floor) {
      floor = { ...meta(), surveyId: survey.id, level, name: `Етаж ${level}` } satisfies Floor;
      await save('floors', floor);
    }
    const name = roomForm.room.trim();
    if (data.value!.rooms.some(r => r.floorId === floor!.id && r.name.toLowerCase() === name.toLowerCase()))
      return toast('Такова помещение вече има на този етаж.');
    await save('rooms', { ...meta(), surveyId: survey.id, floorId: floor.id, name } satisfies Room);
    roomOpen = false;
    toast('Помещението е добавено.');
  }

  // --- add rack ---
  let rackOpen = $state(false);
  let rackForm = $state({ roomId: '', name: '', uHeight: 42 });
  function openRack() {
    if (!data.value?.rooms.length) {
      toast('Първо добави помещение.');
      roomForm = { level: 1, room: '' };
      roomOpen = true;
      return;
    }
    rackForm = { roomId: data.value.rooms[0].id, name: `R${String(data.value.racks.length + 1).padStart(2, '0')}`, uHeight: 42 };
    rackOpen = true;
  }
  async function addRack(e: SubmitEvent) {
    e.preventDefault();
    if (!survey || !rackForm.name.trim()) return;
    const uHeight = Math.trunc(Number(rackForm.uHeight));
    if (!(uHeight >= 1 && uHeight <= 60)) return toast('Височината трябва да е между 1 и 60 U.');
    const rack: Rack = { ...meta(), surveyId: survey.id, roomId: rackForm.roomId, name: rackForm.name.trim(), uHeight, notes: '' };
    await save('racks', rack);
    rackOpen = false;
    go('/r/' + rack.id);
  }

  // --- photos / notes / status ---
  let photosOpen = $state(false);
  let notesOpen = $state(false);
  let notes = $state('');

  async function setStatus(status: SurveyStatus) {
    if (survey) await save('surveys', { ...$state.snapshot(survey), status });
  }
  async function saveNotes(e: SubmitEvent) {
    e.preventDefault();
    if (survey) await save('surveys', { ...$state.snapshot(survey), notes });
    notesOpen = false;
  }
  // --- elevation images from the device type library ---
  const linkedCount = $derived(data.value?.devices.filter(d => d.catalog).length ?? 0);
  const imageCount = $derived(data.value?.devices.filter(d => d.catalog?.front || d.catalog?.rear).length ?? 0);
  let imgBusy = $state('');
  async function prepareImages() {
    const v = data.value;
    if (!v) return;
    imgBusy = 'Свързвам моделите…';
    try {
      const changed = await autoLink($state.snapshot(v.devices));
      if (changed.length) await saveMany([{ table: 'devices', rows: changed }]);
      const all = [...v.devices.filter(d => !changed.some(c => c.id === d.id)), ...changed];
      const res = await cacheImages(all, (done, total) => (imgBusy = `Свалям изгледите ${done} / ${total}…`));
      toast(`Свързани още ${changed.length}. Свалени изгледи: ${res.ok}${res.failed ? `, неуспешни: ${res.failed}` : ''}.`);
    } finally {
      imgBusy = '';
    }
  }

  let exporting = $state(false);
  async function download(thenRemove: boolean) {
    if (!survey) return;
    exporting = true;
    try {
      const { blob, name } = await exportSurvey(survey.id);
      downloadBlob(blob, name);
      toast(`Изтеглен: ${name}`);
      if (thenRemove) {
        await new Promise(r => setTimeout(r, 800));
        if (confirm(`Файлът „${name}“ е изтеглен. Провери, че е в папката с изтеглени файлове.\n\nДа махна ли огледа от сайта и от всички устройства? Може да го възстановиш по-късно от „Внос“ с този файл.`)) {
          await deleteSurvey(survey.id);
          go('/');
        }
      }
    } catch (err) {
      toast((err as Error).message);
    } finally {
      exporting = false;
    }
  }

  async function remove() {
    if (!survey || !confirm(`Да изтрия ли целия оглед „${survey.tenant} · ${survey.site}“? Това не може да се върне.`)) return;
    await deleteSurvey(survey.id);
    go('/');
  }
</script>

<header class="topbar">
  <div class="row">
    <a class="icon-btn" href="#/" aria-label="Назад към огледите" style="margin-left: -10px"><Icon name="back" /></a>
    <Status />
  </div>
  {#if survey}
    <div>
      <div class="title">{survey.tenant}</div>
      <div class="sub">{survey.site}{survey.building ? ' · ' + survey.building : ''}{survey.author ? ' · ' + survey.author : ''}</div>
    </div>
  {/if}
</header>

{#if data.loaded && !survey}
  <main><div class="empty">Огледът не е намерен на това устройство.</div></main>
{:else if survey && data.value}
  <main>
    <div class="quick">
      <button class="btn" onclick={openRack}><Icon name="rack" size={20} stroke="#C2410C" />Шкаф</button>
      <button class="btn" onclick={() => { roomForm = { level: data.value?.floors.at(-1)?.level ?? 1, room: '' }; roomOpen = true; }}><Icon name="room" size={20} stroke="#C2410C" />Помещение</button>
      <button class="btn" onclick={() => (photosOpen = true)}><Icon name="camera" size={20} stroke="#C2410C" />Снимки</button>
    </div>

    {#if !data.value.rooms.length}
      <div class="empty">Добави помещение (например „Сървърно 1.04“), после шкафовете в него.</div>
    {/if}

    {#each data.value.floors as floor (floor.id)}
      {@const rooms = data.value.rooms.filter(r => r.floorId === floor.id)}
      {#if rooms.length}
        <div class="section-title">{floor.name} · помещения <a class="btn small" href={'#/floor/' + floor.id} style="text-decoration: none">План на етажа</a></div>
        <div class="list">
          {#each rooms as room (room.id)}
            <a href={'#/room/' + room.id}>
              <div><div style="font-weight: 600">{room.name}</div><div class="muted">{plural(racksIn(room.id).length, 'шкаф', 'шкафа')}</div></div>
              <Icon name="chevron" size={18} />
            </a>
          {/each}
        </div>
      {/if}
    {/each}

    {#if data.value.racks.length}
      <div class="section-title">Шкафове</div>
      {#each data.value.racks as rack (rack.id)}
        {@const devs = devicesIn(rack.id)}
        {@const used = usedUnits(rack.uHeight, devs)}
        {@const check = devs.filter(d => d.status === 'check').length}
        <a class="card" href={'#/r/' + rack.id}>
          <div style="display: flex; justify-content: space-between; align-items: baseline">
            <span style="font-weight: 600; font-size: 17px">{rack.name} <span class="muted" style="font-weight: 400">· {roomName(rack.roomId)}</span></span>
            <span class="mono muted" style="font-size: 13px">{rack.uHeight}U · {used} заети</span>
          </div>
          <div class="bar"><div style="width: {Math.round((used / rack.uHeight) * 100)}%"></div></div>
          {#if check}<div style="font-size: 13px; color: var(--accent-ink)">{check} за проверка</div>
          {:else if devs.length}<div style="font-size: 13px; color: var(--ok)">Всичко потвърдено</div>
          {:else}<div class="muted" style="font-size: 13px">Празен</div>{/if}
        </a>
      {/each}
    {/if}

    <div class="section-title">Оглед</div>
    <div class="list">
      <label style="cursor: pointer">
        <span style="font-weight: 600">Статус</span>
        <select value={survey.status} onchange={e => setStatus((e.target as HTMLSelectElement).value as SurveyStatus)} style="min-height: 40px; border: 1px solid var(--field); border-radius: 8px; padding: 0 8px; background: #fff">
          {#each Object.entries(statusLabel) as [k, v]}<option value={k}>{v}</option>{/each}
        </select>
      </label>
      <button type="button" style="border: 0; background: none; width: 100%; text-align: left; cursor: pointer" onclick={() => { notes = survey.notes; notesOpen = true; }}>
        <span><span style="font-weight: 600">Бележки</span><br /><span class="muted">{survey.notes || 'няма'}</span></span>
        <Icon name="chevron" size={18} />
      </button>
    </div>
    <div class="card">
      <h3 style="font-size: 15px">Изгледи на моделите</h3>
      <p class="muted" style="margin: 0">{linkedCount} от {data.value?.devices.length ?? 0} устройства са свързани с каталога, {imageCount} имат изглед. Преди обект без връзка свали изгледите, за да се виждат и офлайн.</p>
      <button class="btn small dark" style="align-self: flex-start" onclick={prepareImages} disabled={!!imgBusy}>{imgBusy || 'Свържи моделите и свали изгледите'}</button>
    </div>
    <div class="card">
      <h3 style="font-size: 15px">Файл</h3>
      <p class="muted" style="margin: 0">Целият оглед със снимките в един файл. С него може да го възстановиш по-късно от „Внос“, на този или друг сайт.</p>
      <div style="display: flex; gap: 8px; flex-wrap: wrap">
        <button class="btn small dark" onclick={() => download(false)} disabled={exporting}>Изтегли огледа</button>
        <button class="btn small" onclick={() => download(true)} disabled={exporting}>Изтегли и махни от сайта</button>
      </div>
    </div>
    <button class="btn danger small" onclick={remove} style="align-self: flex-start"><Icon name="trash" size={18} /> Изтрий огледа</button>
  </main>

  <Sheet bind:open={roomOpen} title="Ново помещение">
    <form class="stack" onsubmit={addRoom}>
      <div class="grid2">
        <div class="field"><label for="lv">Етаж (−1, 0, 1 …)</label><input id="lv" type="number" step="1" bind:value={roomForm.level} /></div>
        <div class="field"><label for="rn">Помещение</label><input id="rn" bind:value={roomForm.room} placeholder="Сървърно 1.04" required /></div>
      </div>
      <button class="btn primary block" type="submit">Добави</button>
    </form>
  </Sheet>

  <Sheet bind:open={rackOpen} title="Нов шкаф">
    <form class="stack" onsubmit={addRack}>
      <div class="field">
        <label for="rr">Помещение</label>
        <select id="rr" bind:value={rackForm.roomId}>
          {#each data.value.rooms as r (r.id)}<option value={r.id}>{data.value.floors.find(f => f.id === r.floorId)?.name} · {r.name}</option>{/each}
        </select>
      </div>
      <div class="grid2">
        <div class="field"><label for="rk">Име</label><input id="rk" bind:value={rackForm.name} class="mono" required /></div>
        <div class="field"><label for="ru">Височина (U)</label><input id="ru" type="number" min="1" max="60" bind:value={rackForm.uHeight} /></div>
      </div>
      <button class="btn primary block" type="submit">Създай и отвори</button>
    </form>
  </Sheet>

  <Sheet bind:open={photosOpen} title="Снимки от обекта">
    <Photos surveyId={survey.id} ownerKind="survey" ownerId={survey.id} />
  </Sheet>

  <Sheet bind:open={notesOpen} title="Бележки за огледа">
    <form class="stack" onsubmit={saveNotes}>
      <div class="field"><label for="nt">Бележки</label><textarea id="nt" bind:value={notes} rows="6"></textarea></div>
      <button class="btn primary block" type="submit">Запази</button>
    </form>
  </Sheet>
{/if}
