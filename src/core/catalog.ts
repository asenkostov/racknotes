// Device type catalog from netbox-community/devicetype-library (CC0):
// search by manufacturer + model, and links to elevation images.
// Pure functions; the JSON is loaded by src/web/lib/catalog.svelte.ts.

export interface CatalogFile {
  v: 1;
  sha: string;
  makers: string[];
  /** [maker index, model, part number ('' = same as model), slug, U, full depth 0/1, front ext, rear ext] */
  types: [number, string, string, string, number, 0 | 1, string, string][];
}

export interface CatalogType {
  manufacturer: string;
  model: string;
  part: string;
  slug: string;
  uHeight: number;
  fullDepth: boolean;
  /** Paths inside the library, e.g. "Cisco/cisco-c9200l-48t-4x.front.png" */
  front?: string;
  rear?: string;
}

/** Link from a device to its catalog entry, stored on the device. */
export interface CatalogRef {
  slug: string;
  front?: string;
  rear?: string;
}

export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '');

/** Words that describe a product but are rarely part of the catalog model name. */
const FILLER = /\b(chassis|appliance|switch|router|secure|compute|node|server|module|series|unit|enclosure)\b/g;
/** Model text without filler words, e.g. "UCS X9508 Chassis" -> "ucsx9508". */
export const core = (s: string) => norm(s.toLowerCase().replace(FILLER, ' '));

/** Common ways people write manufacturer names that the library spells differently. */
const MAKER_ALIASES: Record<string, string> = {
  hewlettpackardenterprise: 'hpe',
  hewlettpackard: 'hp',
  paloalto: 'paloaltonetworks',
  pan: 'paloaltonetworks',
  apcbyschneiderelectric: 'apc',
  schneider: 'apc',
  ciscosystems: 'cisco',
  dellemc: 'dell',
  ibmlenovo: 'lenovo'
};

export class Catalog {
  readonly types: CatalogType[];
  readonly makers: string[];
  readonly sha: string;
  private byMaker = new Map<string, CatalogType[]>();
  private bySlug = new Map<string, CatalogType>();
  private keys: { t: CatalogType; model: string; part: string; tail: string; core: string }[] = [];

  constructor(file: CatalogFile) {
    this.sha = file.sha;
    this.makers = file.makers;
    this.types = file.types.map(([mi, model, part, slug, u, full, f, r]) => {
      const manufacturer = file.makers[mi];
      return {
        manufacturer,
        model,
        part: part || model,
        slug,
        uHeight: u,
        fullDepth: full === 1,
        front: f ? `${manufacturer}/${slug}.front.${f}` : undefined,
        rear: r ? `${manufacturer}/${slug}.rear.${r}` : undefined
      };
    });
    for (const t of this.types) {
      const k = norm(t.manufacturer);
      if (!this.byMaker.has(k)) this.byMaker.set(k, []);
      this.byMaker.get(k)!.push(t);
      this.bySlug.set(t.slug, t);
      const m = norm(t.model);
      const mk = norm(t.manufacturer);
      // Slug without the manufacturer prefix, e.g. "c9200l48t4x".
      const tail = norm(t.slug).startsWith(mk) ? norm(t.slug).slice(mk.length) : norm(t.slug);
      this.keys.push({ t, model: m, part: norm(t.part), tail, core: core(t.model) });
    }
  }

  /** Canonical manufacturer name from the library for what the user typed, if any. */
  maker(input: string): string | undefined {
    const n = norm(input);
    if (!n) return undefined;
    const k = MAKER_ALIASES[n] ?? n;
    return this.byMaker.get(k)?.[0]?.manufacturer;
  }

  get(slug: string): CatalogType | undefined {
    return this.bySlug.get(slug);
  }

  /**
   * Best matches for manufacturer + model text. Scores exact model / part
   * number / slug matches above prefix and substring matches; within one
   * score, entries with images come first.
   */
  search(manufacturer: string, model: string, limit = 8): CatalogType[] {
    const q = norm(model);
    if (q.length < 2) return [];
    const maker = manufacturer ? this.maker(manufacturer) : undefined;
    const pool = maker ? this.keys.filter(k => k.t.manufacturer === maker) : this.keys;
    // Model text often carries the brand too ("Cisco Catalyst 9200L").
    const qs = [...new Set([q, core(model), maker ? q.replace(norm(maker), '') : ''])].filter(x => x.length >= 2);
    const scored: { t: CatalogType; s: number }[] = [];
    for (const k of pool) {
      let s = 0;
      for (const x of qs) {
        if (x === k.model || x === k.part || x === k.tail) s = Math.max(s, 100);
        else if (k.part.startsWith(x) || k.model.startsWith(x) || k.tail.startsWith(x)) s = Math.max(s, 60 + Math.min(30, x.length));
        else if (x.length >= 3 && (k.model.includes(x) || k.part.includes(x) || k.tail.includes(x))) s = Math.max(s, 30 + Math.min(20, x.length));
        // What the user typed is a longer variant of a known part, e.g. "C9200L-48T-4X-E".
        else if (k.part.length >= 5 && x.startsWith(k.part)) s = Math.max(s, 50);
      }
      if (s) scored.push({ t: k.t, s: s + (k.t.front ? 5 : 0) - k.t.model.length / 100 });
    }
    return scored.sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.t);
  }

  /** A single confident match (exact model, part number or slug), for automatic linking. */
  exact(manufacturer: string, model: string, slug?: string): CatalogType | undefined {
    if (slug && this.bySlug.has(slug)) {
      const t = this.bySlug.get(slug)!;
      if (!manufacturer || this.maker(manufacturer) === t.manufacturer) return t;
    }
    const maker = this.maker(manufacturer);
    if (!maker) return undefined;
    const q = norm(model);
    if (!q) return undefined;
    const own = this.keys.filter(k => k.t.manufacturer === maker);
    const hits = own.filter(k => k.model === q || k.part === q || k.tail === q);
    if (hits.length === 1) return hits[0].t;
    if (hits.length) return undefined;
    // Second chance without filler words ("UCS X9508 Chassis" = "UCS-X9508").
    const c = core(model);
    if (c.length < 4) return undefined;
    const loose = own.filter(k => k.core === c || k.part === c || k.tail === c);
    return loose.length === 1 ? loose[0].t : undefined;
  }
}

export const ref = (t: CatalogType): CatalogRef => ({ slug: t.slug, ...(t.front ? { front: t.front } : {}), ...(t.rear ? { rear: t.rear } : {}) });

/** URL of an elevation image, pinned to the catalog's commit. */
export const imageUrl = (sha: string, path: string) =>
  `https://raw.githubusercontent.com/netbox-community/devicetype-library/${sha}/elevation-images/${path.split('/').map(encodeURIComponent).join('/')}`;
