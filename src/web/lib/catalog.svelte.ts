// Loads the device type catalog (public/catalog/devicetypes.json) once, on demand.
// The file is precached by the service worker, so it also works offline.
import { Catalog, imageUrl, ref, type CatalogFile } from '../../core/catalog.ts';
import type { Device } from '../../core/model.ts';

export const catalog = $state<{ cat: Catalog | null; error: string }>({ cat: null, error: '' });
let pending: Promise<Catalog | null> | null = null;

export function loadCatalog(): Promise<Catalog | null> {
  if (catalog.cat) return Promise.resolve(catalog.cat);
  pending ??= fetch('/catalog/devicetypes.json')
    .then(r => (r.ok ? (r.json() as Promise<CatalogFile>) : Promise.reject(new Error(String(r.status)))))
    .then((f: CatalogFile) => (catalog.cat = new Catalog(f)))
    .catch(e => {
      catalog.error = 'Каталогът с модели не можа да се зареди.';
      pending = null;
      console.warn('catalog', e);
      return null;
    });
  return pending;
}

export const imgUrl = (path: string) => imageUrl(catalog.cat?.sha ?? 'master', path);

/** Link devices to the catalog where the match is certain. Returns the changed devices. */
export async function autoLink(devices: Device[]): Promise<Device[]> {
  const cat = await loadCatalog();
  if (!cat) return [];
  const out: Device[] = [];
  for (const d of devices) {
    if (d.catalog) continue;
    const t = cat.exact(d.manufacturer, d.model, d.typeSlug);
    if (t) out.push({ ...d, catalog: ref(t) });
  }
  return out;
}

/** Download the elevation images of these devices into the offline cache. */
export async function cacheImages(devices: Device[], onProgress?: (done: number, total: number) => void): Promise<{ ok: number; failed: number }> {
  await loadCatalog();
  const paths = [...new Set(devices.flatMap(d => [d.catalog?.front, d.catalog?.rear]).filter((p): p is string => !!p))];
  let ok = 0;
  let failed = 0;
  for (const [i, p] of paths.entries()) {
    try {
      // Goes through the service worker, which keeps the response in its image cache.
      const r = await fetch(imgUrl(p), { mode: 'cors' });
      if (r.ok) ok++;
      else failed++;
    } catch {
      failed++;
    }
    onProgress?.(i + 1, paths.length);
  }
  return { ok, failed };
}
