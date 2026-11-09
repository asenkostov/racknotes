// Builds public/catalog/devicetypes.json from a checkout of
// netbox-community/devicetype-library (CC0). Only names, sizes and which
// elevation images exist — the images themselves are loaded on demand.
//
// usage: node scripts/build-catalog.mjs <library-checkout> <images-list.txt> <commit-sha>
//   images-list.txt: output of `git ls-tree -r --name-only HEAD elevation-images`
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [root, imagesList, sha] = process.argv.slice(2);
if (!root || !imagesList || !sha) throw new Error('usage: build-catalog.mjs <checkout> <images.txt> <sha>');

const images = new Map(); // "Manufacturer/slug" -> { f, r }
for (const line of readFileSync(imagesList, 'utf8').split('\n')) {
  const m = line.match(/^elevation-images\/(.+?)\/([^/]+)\.(front|rear)\.([a-z]+)$/i);
  if (!m) continue;
  const key = `${m[1]}/${m[2]}`;
  const e = images.get(key) ?? {};
  e[m[3] === 'front' ? 'f' : 'r'] = m[4];
  images.set(key, e);
}

// Top-level scalar keys are enough; avoids a YAML dependency.
const scalar = (text, key) => {
  const m = text.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
  if (!m) return undefined;
  let v = m[1].trim();
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1).replace(/''/g, "'");
  return v;
};

const dir = join(root, 'device-types');
const makers = readdirSync(dir).sort((a, b) => a.localeCompare(b));
const types = [];
for (const [mi, maker] of makers.entries()) {
  for (const file of readdirSync(join(dir, maker)).sort()) {
    if (!/\.ya?ml$/.test(file)) continue;
    const text = readFileSync(join(dir, maker, file), 'utf8');
    const model = scalar(text, 'model');
    const slug = scalar(text, 'slug');
    if (!model || !slug) continue;
    const u = Number(scalar(text, 'u_height') ?? 1);
    const full = scalar(text, 'is_full_depth') !== 'false';
    const part = scalar(text, 'part_number') ?? '';
    const img = images.get(`${maker}/${slug}`) ?? {};
    // [maker index, model, part number, slug, U height, full depth 0/1, front ext, rear ext]
    types.push([mi, model, part === model ? '' : part, slug, Number.isFinite(u) ? u : 1, full ? 1 : 0, img.f ?? '', img.r ?? '']);
  }
}

mkdirSync('public/catalog', { recursive: true });
const out = { v: 1, source: 'netbox-community/devicetype-library', license: 'CC0-1.0', sha, makers, types };
writeFileSync('public/catalog/devicetypes.json', JSON.stringify(out));
const withImg = types.filter(t => t[6] || t[7]).length;
console.log(`${types.length} device types, ${makers.length} manufacturers, ${withImg} with images`);
