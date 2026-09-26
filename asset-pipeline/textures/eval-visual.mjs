// Visual check: raking-light shading of reference vs lossy normals (512px crop at 1:1) + mip-1 angular error.
import sharp from 'sharp';
import path from 'node:path';
import { loadPlanes, normalToRGB8, rawOpts } from './lib.mjs';
const W = 2048, n = W * W, C = 512;
const L = [0.6, 0.45, 0.66]; const ll = Math.hypot(...L); L.forEach((v, i) => (L[i] = v / ll));
function shade(rgb, w, x0, y0, c) {
  const out = Buffer.alloc(c * c);
  for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) {
    const i = ((y0 + y) * w + x0 + x) * 3;
    const v = [rgb[i] / 127.5 - 1, rgb[i + 1] / 127.5 - 1, rgb[i + 2] / 127.5 - 1];
    const d = Math.max(0, v[0] * L[0] + v[1] * L[1] + v[2] * L[2]) / Math.hypot(...v);
    out[y * c + x] = Math.round(Math.pow(d, 1.5) * 255);
  }
  return out;
}
function mip1Err(a, b) {
  const w2 = W / 2; let s = 0, cnt = 0; const errs = [];
  for (let y = 0; y < w2; y++) for (let x = 0; x < w2; x++) {
    const va = [0, 0, 0], vb = [0, 0, 0];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const i = ((2 * y + dy) * W + 2 * x + dx) * 3; for (let k = 0; k < 3; k++) { va[k] += a[i + k] / 127.5 - 1; vb[k] += b[i + k] / 127.5 - 1; } }
    const d = (va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]) / (Math.hypot(...va) * Math.hypot(...vb));
    const e = Math.acos(Math.min(1, d)) * 180 / Math.PI; s += e; cnt++; if ((x + y) % 7 === 0) errs.push(e);
  }
  errs.sort((p, q) => p - q); return { mean: s / cnt, p99: errs[Math.floor(errs.length * 0.99)] };
}
const comps = []; let row = 0;
for (const set of process.argv.slice(2)) {
  const nor = await loadPlanes(path.join('raw', set, 'nor_gl.png'));
  const ref = normalToRGB8(nor.planes, nor.w, nor.h, W);
  const lossy = await sharp(await sharp(ref, rawOpts(W)).webp({ quality: 92, smartSubsample: true, effort: 5 }).toBuffer()).removeAlpha().raw().toBuffer();
  const e = mip1Err(ref, lossy);
  console.log(set, 'mip1 angular err mean', e.mean.toFixed(2), 'p99', e.p99.toFixed(2));
  const x0 = 700, y0 = 700;
  for (const [k, buf] of [ref, lossy].entries()) comps.push({ input: await sharp(shade(buf, W, x0, y0, C), { raw: { width: C, height: C, channels: 1 } }).png().toBuffer(), left: k * C, top: row * C });
  row++;
}
await sharp({ create: { width: 2 * C, height: row * C, channels: 3, background: '#000' } }).composite(comps).png().toFile('eval_visual.png');
