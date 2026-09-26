// Write public/assets/textures/manifest.json and CREDITS.md from sets.mjs + meta/<set>.json + shipped files.
import fs from 'node:fs';
import path from 'node:path';
import { SETS } from './sets.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const PROJECT = path.resolve(ROOT, '..', '..');
const TEX = path.join(PROJECT, 'public', 'assets', 'textures');
const round2 = (v) => Math.round(v * 100) / 100;

const manifest = {};
const rows = [];
for (const [set, cfg] of Object.entries(SETS)) {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'meta', `${set}.json`), 'utf8'));
  const info = meta.info;
  const files = fs.readdirSync(path.join(TEX, set));
  const maps = ['diff', 'nor', 'arm', 'height'].filter((m) => files.includes(`${m}.webp`));
  let title, authors, url, sourceMeters = null;
  if (cfg.source === 'polyhaven') {
    title = info.name;
    authors = Object.entries(info.authors).map(([name, role]) => (role === 'All' ? name : `${name} (${role})`)).join(', ');
    url = `https://polyhaven.com/a/${cfg.id}`;
    sourceMeters = round2(info.dimensions[0] / 1000);
  } else {
    title = info.displayName;
    authors = 'ambientCG (Lennart Demes)';
    url = `https://ambientcg.com/view?id=${cfg.id}`;
  }
  manifest[set] = {
    id: cfg.id,
    source: cfg.source,
    scaleMeters: cfg.scaleMeters,
    ...(sourceMeters ? { sourceMeters } : {}),
    maps,
    lowSuffix: '.1k',
    ...(cfg.source === 'ambientcg' || !fs.existsSync(path.join(ROOT, 'raw', set, 'ao.png')) ? { aoIsWhite: true } : {}),
    ...(cfg.normalFromHeight ? { normalDerivedFromHeight: true } : {}),
  };
  rows.push({ set, id: cfg.id, title, authors, url, source: cfg.source === 'polyhaven' ? 'Poly Haven' : 'ambientCG', sourceMeters });
}
fs.writeFileSync(path.join(TEX, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const md = [
  '# Texture credits',
  '',
  'All textures below are licensed **CC0 1.0 Universal (public domain)**. Attribution is not required but is given here with thanks.',
  '',
  'Maps were downloaded at 2K and re-encoded to WebP (diffuse sRGB q85; OpenGL +Y normals q80; ARM = R ambient occlusion, G roughness, B metalness 0, near-lossless; optional grayscale height, percentile-stretched to 0..1). `*.1k.webp` are 2:1 box-downsampled versions for the low quality preset. Build scripts live in `asset-pipeline/textures/`.',
  '',
  'Modifications: `marble` (ambientCG Marble019) ships no AO map, so its ARM red channel is white; its normal map was re-derived from the source displacement map because the supplied NormalGL is nearly flat.',
  '',
  '| Set | Source | Asset id | Title | Author(s) | Scanned size | Licence | URL |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.set} | ${r.source} | \`${r.id}\` | ${r.title} | ${r.authors} | ${r.sourceMeters ? `${r.sourceMeters} m` : 'n/a'} | CC0 | ${r.url} |`),
  '',
  '- Poly Haven licence: https://polyhaven.com/license',
  '- ambientCG licence: https://docs.ambientcg.com/license/',
  '',
].join('\n');
fs.writeFileSync(path.join(TEX, 'CREDITS.md'), md);
console.log(JSON.stringify(manifest, null, 2));
