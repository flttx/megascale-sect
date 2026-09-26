// Download 2K source maps for each chosen set into raw/<set>/ (+ asset metadata into meta/).
// Poly Haven: diff (jpg 4:4:4), nor_gl / AO / Rough / Displacement (png). ambientCG: 2K-PNG zip.
// Usage: node download.mjs [set ...]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SETS } from './sets.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAW = path.join(ROOT, 'raw');
const META = path.join(ROOT, 'meta');
fs.mkdirSync(META, { recursive: true });

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'tripo-building-texture-pipeline' } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

async function download(url, dest, md5) {
  if (fs.existsSync(dest) && (!md5 || crypto.createHash('md5').update(fs.readFileSync(dest)).digest('hex') === md5)) {
    console.log('  cached', path.basename(dest));
    return;
  }
  const r = await fetch(url, { headers: { 'User-Agent': 'tripo-building-texture-pipeline' } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (md5) {
    const got = crypto.createHash('md5').update(buf).digest('hex');
    if (got !== md5) throw new Error(`md5 mismatch for ${url}: ${got} != ${md5}`);
  }
  fs.writeFileSync(dest, buf);
  console.log('  got', path.basename(dest), (buf.length / 1e6).toFixed(1) + 'MB');
}

async function polyhaven(set, cfg, dir) {
  const info = await getJson(`https://api.polyhaven.com/info/${cfg.id}`);
  const files = await getJson(`https://api.polyhaven.com/files/${cfg.id}`);
  fs.writeFileSync(path.join(META, `${set}.json`), JSON.stringify({ source: 'polyhaven', id: cfg.id, info }, null, 2));
  const want = [
    ['diff', 'Diffuse', 'jpg'],
    ['nor_gl', 'nor_gl', 'png'],
    ['ao', 'AO', 'png'],
    ['rough', 'Rough', 'png'],
  ];
  if (cfg.height) want.push(['disp', 'Displacement', 'png']);
  for (const [name, key, fmt] of want) {
    const f = files[key]?.['2k']?.[fmt];
    if (!f) {
      console.warn(`  ! ${cfg.id} has no 2k ${key}.${fmt}`);
      continue;
    }
    await download(f.url, path.join(dir, `${name}.${fmt}`), f.md5);
  }
}

async function ambientcg(set, cfg, dir) {
  const j = await getJson(`https://ambientcg.com/api/v2/full_json?id=${cfg.id}&include=downloadData,tagData,dimensionsData`);
  const a = j.foundAssets[0];
  const dl = a.downloadFolders.default.downloadFiletypeCategories.zip.downloads.find((d) => d.attribute === '2K-PNG');
  const meta = { ...a };
  delete meta.downloadFolders;
  fs.writeFileSync(path.join(META, `${set}.json`), JSON.stringify({ source: 'ambientcg', id: cfg.id, info: meta }, null, 2));
  const zip = path.join(dir, dl.fileName);
  await download(dl.downloadLink, zip);
  execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
  const pick = (suffix) => fs.readdirSync(dir).find((f) => f.endsWith(suffix));
  const map = { diff: '_Color.png', nor_gl: '_NormalGL.png', rough: '_Roughness.png', ao: '_AmbientOcclusion.png', disp: '_Displacement.png' };
  for (const [name, suffix] of Object.entries(map)) {
    const f = pick(suffix);
    if (f) fs.copyFileSync(path.join(dir, f), path.join(dir, `${name}.png`));
    else console.warn(`  ! ${cfg.id} has no ${suffix}`);
  }
}

const only = process.argv.slice(2);
for (const [set, cfg] of Object.entries(SETS)) {
  if (only.length && !only.includes(set)) continue;
  const dir = path.join(RAW, set);
  fs.mkdirSync(dir, { recursive: true });
  console.log(`[${set}] ${cfg.source}:${cfg.id}`);
  if (cfg.source === 'polyhaven') await polyhaven(set, cfg, dir);
  else await ambientcg(set, cfg, dir);
}
