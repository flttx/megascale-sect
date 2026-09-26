// Contact sheet: per set -> diff | nor | arm | lit (diff shaded by nor, raking light) | height, labelled.
// Reads the FINAL webp files so it reflects exactly what ships.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { SETS } from './sets.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const PROJECT = path.resolve(ROOT, '..', '..');
const TEX = path.join(PROJECT, 'public', 'assets', 'textures');
const OUT = path.join(PROJECT, 'artifacts', 'assets', 'textures', 'contact.png');
const T = 320, LBL = 26, HEAD = 30;
const COLS = ['diff', 'nor', 'arm', 'lit', 'height'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const label = (text, w, h, size = 15, bg = '#1c1c1c') =>
  Buffer.from(`<svg width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/><text x="6" y="${h - 8}" font-family="Arial" font-size="${size}" fill="#eee">${esc(text)}</text></svg>`);

async function lit(set) {
  const S = 1024;
  const d = await sharp(path.join(TEX, set, 'diff.1k.webp')).removeAlpha().raw().toBuffer();
  const n = await sharp(path.join(TEX, set, 'nor.1k.webp')).removeAlpha().raw().toBuffer();
  const L = [-0.55, 0.45, 0.7];
  const ll = Math.hypot(...L);
  const out = Buffer.alloc(S * S * 3);
  for (let i = 0; i < S * S; i++) {
    const nx = n[i * 3] / 127.5 - 1, ny = n[i * 3 + 1] / 127.5 - 1, nz = n[i * 3 + 2] / 127.5 - 1;
    const ndl = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / (ll * Math.hypot(nx, ny, nz)));
    const k = 0.25 + 1.1 * ndl;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.min(255, Math.round(d[i * 3 + c] * k));
  }
  return sharp(out, { raw: { width: S, height: S, channels: 3 } }).resize(T, T).png().toBuffer();
}

const sets = Object.keys(SETS);
const manifest = JSON.parse(fs.readFileSync(path.join(TEX, 'manifest.json'), 'utf8'));
const W = COLS.length * T, H = HEAD + sets.length * (T + LBL);
const comps = [{ input: label('diff (sRGB) | nor (OpenGL +Y) | arm (R=AO G=rough B=metal) | lit preview (light from upper-left) | height', W, HEAD, 16, '#000'), left: 0, top: 0 }];
for (const [r, set] of sets.entries()) {
  const y = HEAD + r * (T + LBL);
  const m = manifest[set];
  comps.push({ input: label(`${set}  —  ${m.source}:${m.id}  —  tile ${m.scaleMeters} m`, W, LBL, 15), left: 0, top: y });
  for (const [c, map] of COLS.entries()) {
    let buf;
    if (map === 'lit') buf = await lit(set);
    else {
      const f = path.join(TEX, set, `${map}.webp`);
      if (!fs.existsSync(f)) continue;
      buf = await sharp(f).resize(T, T).png().toBuffer();
    }
    comps.push({ input: buf, left: c * T, top: y + LBL });
  }
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await sharp({ create: { width: W, height: H, channels: 3, background: '#333' } }).composite(comps).png().toFile(OUT);
console.log('wrote', OUT);
