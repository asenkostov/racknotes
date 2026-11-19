<script lang="ts">
  import type { Device, Face, Rack } from '../../core/model.ts';
  import { elevation, uLabel } from '../../core/rack.ts';
  import { roleColors } from '../../core/roles.ts';
  import { imgUrl } from './catalog.svelte.ts';
  import { STATE_LABELS, STATE_SYMBOLS, verifyState } from '../../core/verify.ts';

  // One face of a rack drawn to scale: every U has the same height, devices sit
  // at their real position, devices mounted on the other face that are full
  // depth are shown hatched, free space links to "add a device here".

  let {
    rack,
    devices,
    face,
    uPx = 20,
    childCount = new Map<string, number>(),
    label = '',
    images = true,
    verifying = false,
    moving = null,
    onpick,
    ontarget
  }: {
    rack: Rack;
    devices: Device[];
    face: Face;
    uPx?: number;
    childCount?: Map<string, number>;
    label?: string;
    images?: boolean;
    verifying?: boolean;
    /** Move mode: the device being moved (highlighted). */
    moving?: string | null;
    /** Move mode on: tapping a device picks it instead of opening it. */
    onpick?: (d: Device) => void;
    /** Move mode, device picked: tapping free space moves it there. */
    ontarget?: (face: Face, top: number, bottom: number, at: number) => void;
  } = $props();
  /** Trays and shelves: up to this many devices inside are drawn side by side. */
  const MAX_CELLS = 4;
  const kidsOf = (id: string) => devices.filter(c => c.parentId === id).sort((a, b) => a.name.localeCompare(b.name));
  /** Chassis state also reflects its children: anything pending inside keeps it pending. */
  const stateOf = (d: Device) => {
    const own = verifyState(d);
    if (own !== 'ok') return own;
    return devices.some(c => c.parentId === d.id && verifyState(c) === 'pending') ? 'pending' : own;
  };

  // Images that failed to load (offline, not cached) fall back to the role colour.
  let broken = $state(new Set<string>());
  /** Seen from its own face a device shows its front image; from the other face, its rear. */
  const imageOf = (d: Device) => {
    if (!images || !d.catalog) return undefined;
    const p = d.face === face ? d.catalog.front : d.catalog.rear;
    return p && !broken.has(p) ? p : undefined;
  };

  const placed = $derived(devices.filter(d => !d.parentId));
  const byId = $derived(new Map(placed.map(d => [d.id, d])));
  const segs = $derived(elevation(rack.uHeight, placed, face));
  const units = $derived(Array.from({ length: rack.uHeight }, (_, i) => rack.uHeight - i));
  const top = (u: number) => (rack.uHeight - u) * uPx;
  const height = (topU: number, bottomU: number) => (topU - bottomU + 1) * uPx;
</script>

<div class="elev">
  {#if label}<div class="elev-label">{label}</div>{/if}
  <div class="elev-body">
    <div class="elev-units" aria-hidden="true">
      {#each units as u}<span style="height: {uPx}px; line-height: {uPx}px">{u}</span>{/each}
    </div>
    <div class="elev-rack" style="height: {rack.uHeight * uPx}px; background-size: 100% {uPx}px">
      {#each segs as s (s.kind + s.top)}
        {#if s.kind === 'free' && onpick}
          <button
            type="button"
            class="elev-free"
            class:target={!!moving}
            style="top: {top(s.top)}px; height: {height(s.top, s.bottom) - 1}px"
            disabled={!moving}
            onclick={e => ontarget?.(face, s.top, s.bottom, Math.min(s.top, Math.max(s.bottom, s.top - Math.floor((e.offsetY || 0) / uPx))))}
            aria-label={`Премести в ${uLabel(s.top, s.bottom)}`}
          >
            <span>{moving ? 'премести тук' : ''}</span>
          </button>
        {:else if s.kind === 'free'}
          <a
            class="elev-free"
            style="top: {top(s.top)}px; height: {height(s.top, s.bottom) - 1}px"
            href={`#/d/new?rack=${rack.id}&top=${s.top}&bottom=${s.bottom}&face=${face}`}
            aria-label={`Добави устройство в ${uLabel(s.top, s.bottom)}`}
          >
            <span>+ {s.top - s.bottom + 1 > 1 ? `${s.top - s.bottom + 1}U свободни` : 'свободно'}</span>
          </a>
        {:else}
          {@const d = byId.get(s.id)!}
          {@const other = d.face !== face}
          {@const c = roleColors(d.role, d.roleColor)}
          {@const n = childCount.get(d.id)}
          {@const img = imageOf(d)}
          {@const vs = verifying ? stateOf(d) : null}
          {@const kids = kidsOf(d.id)}
          {@const cells = !other && kids.length > 0 && kids.length <= MAX_CELLS}
          <svelte:element
            this={onpick ? 'button' : cells ? 'div' : 'a'}
            type={onpick ? 'button' : undefined}
            role={onpick ? undefined : cells ? 'group' : undefined}
            onclick={onpick ? () => onpick(d) : undefined}
            class="elev-dev"
            class:img={!!img}
            class:other={other && !img}
            class:check={!verifying && d.status === 'check'}
            class:missing={vs === 'missing'}
            class:moving={moving === d.id}
            class:tray={cells}
            style={other ? `top: ${top(s.top)}px; height: ${height(s.top, s.bottom) - 1}px` : `top: ${top(s.top)}px; height: ${height(s.top, s.bottom) - 1}px; background: ${c.bg}; color: ${c.fg}`}
            href={onpick || cells ? undefined : '#/d/' + d.id}
            title={`${uLabel(s.top, s.bottom)} · ${d.name || d.model} · ${d.manufacturer} ${d.model}${d.role ? ' · ' + d.role : ''}`}
          >
            {#if img}
              <img src={imgUrl(img)} alt="" loading="lazy" onerror={() => (broken = new Set([...broken, img]))} />
            {/if}
            {#if cells}
              <!-- A tray or shelf: its own name, then what sits on it, side by side. -->
              <svelte:element this={onpick ? 'span' : 'a'} class="tray-name" href={onpick ? undefined : '#/d/' + d.id}>{d.name || d.model || 'рафт'}</svelte:element>
              <span class="tray-cells">
                {#each kids as k (k.id)}
                  {@const kc = roleColors(k.role, k.roleColor)}
                  {@const ks = verifying ? verifyState(k) : null}
                  <svelte:element this={onpick ? 'span' : 'a'} class="tray-cell" href={onpick ? undefined : '#/d/' + k.id} style="background: {kc.bg}; color: {kc.fg}" title={`${k.name || k.model} · ${k.manufacturer} ${k.model}`}>
                    <span class="elev-name">{k.name || k.model || 'без име'}</span>
                    {#if ks}<span class="vbadge v-{ks}">{STATE_SYMBOLS[ks]}</span>{/if}
                  </svelte:element>
                {/each}
              </span>
              {#if vs}<span class="vbadge v-{vs}" title={STATE_LABELS[vs]}>{STATE_SYMBOLS[vs]}</span>{/if}
            {:else}
              <span class="elev-name">{d.name || d.model || 'без име'}</span>
              {#if vs}<span class="vbadge v-{vs}" title={STATE_LABELS[vs]}>{STATE_SYMBOLS[vs]}</span>{/if}
              <span class="elev-meta">{other ? 'отзад' : d.status === 'check' ? 'провери' : n ? `+${n} вътре` : ''}</span>
            {/if}
          </svelte:element>
        {/if}
      {/each}
    </div>
  </div>
</div>

<style>
  .elev { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1 1 300px; max-width: 460px; }
  .elev-label { font-size: 12px; font-weight: 600; letter-spacing: 0.6px; text-transform: uppercase; color: var(--muted); padding-left: 32px; }
  .elev-body { display: flex; }
  .elev-units { display: flex; flex-direction: column; width: 28px; margin-right: 4px; flex-shrink: 0; }
  .elev-units span { font: 500 10px var(--mono); color: #6b7b81; text-align: right; }
  .elev-rack {
    position: relative; flex: 1; min-width: 0; background-color: #fff;
    background-image: linear-gradient(to bottom, transparent calc(100% - 1px), var(--line-2) calc(100% - 1px));
    border-left: 6px solid var(--ink); border-right: 6px solid var(--ink); border-radius: 2px;
  }
  .elev-dev, .elev-free {
    position: absolute; left: 0; right: 0; box-sizing: border-box; display: flex; align-items: center;
    justify-content: space-between; gap: 6px; padding: 0 6px; text-decoration: none; overflow: hidden; border-radius: 2px;
  }
  .elev-dev { font: 600 12px var(--sans); border: 1px solid rgba(0, 0, 0, 0.25); }
  .elev-dev:hover, .elev-dev:focus-visible { outline: 3px solid #f08a4b; outline-offset: -1px; z-index: 2; }
  .elev-dev.other {
    background: repeating-linear-gradient(45deg, #c9d2cf 0 3px, #fff 3px 6px); color: var(--muted); border: 1px solid #8a979c; font-weight: 500;
  }
  .elev-dev.check { box-shadow: inset 0 0 0 3px var(--accent); }
  .elev-dev.img { background: #1b2a31 !important; padding: 0; }
  .elev-dev.img img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; }
  .elev-dev.img .elev-name, .elev-dev.img .elev-meta { position: relative; background: rgba(19, 35, 43, 0.78); color: #fff; padding: 0 5px; border-radius: 2px; margin: 0 4px; line-height: 1.4; font-size: 11px; }
  .elev-dev.img .elev-meta:empty { display: none; }
  .vbadge { position: relative; z-index: 1; flex: none; order: 3; width: 18px; height: 18px; max-height: 100%; border-radius: 50%; display: grid; place-items: center; font: 700 11px var(--sans); color: #fff; box-shadow: 0 0 0 1.5px #fff; }
  .vbadge.v-pending { background: #fff; color: #4a5b62; box-shadow: 0 0 0 1.5px #8a979c; }
  .vbadge.v-ok { background: #15803d; }
  .vbadge.v-changed { background: #1d4ed8; }
  .vbadge.v-missing { background: #b91c1c; }
  .vbadge.v-new { background: #7c3aed; }
  .elev-dev.tray { padding: 0 2px 0 6px; gap: 4px; }
  .tray-name { flex: 0 1 auto; max-width: 32%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: inherit; text-decoration: none; font-size: 11px; opacity: 0.85; }
  .tray-cells { flex: 1; display: flex; gap: 2px; height: calc(100% - 4px); min-width: 0; }
  .tray-cell { flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 4px; padding: 0 6px; border-radius: 2px; text-decoration: none; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18); }
  .tray-cell .vbadge { width: 15px; height: 15px; font-size: 10px; }
  button.elev-dev, button.elev-free { border: 0; font: inherit; text-align: left; cursor: pointer; }
  .elev-free.target { background: #eef6ff; outline: 1px dashed #2563eb; outline-offset: -2px; color: #1d4ed8; }
  .elev-free.target span { opacity: 1; }
  .elev-free:disabled { cursor: default; background: transparent; }
  .elev-dev.moving { outline: 3px solid #f08a4b; outline-offset: -1px; z-index: 2; }
  .elev-dev.missing { opacity: 0.55; text-decoration: line-through; }
  .elev-name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; }
  .elev-meta { font-size: 10px; opacity: 0.85; white-space: nowrap; }
  .elev-free { color: #8a979c; font-size: 11px; justify-content: center; }
  .elev-free span { opacity: 0; transition: opacity 0.15s; }
  .elev-free:hover span, .elev-free:focus-visible span { opacity: 1; }
  .elev-free:hover { background: #f6f8f7; outline: 1px dashed #8a979c; outline-offset: -2px; }
  @media (hover: none) { .elev-free span { opacity: 0.8; } }
</style>
