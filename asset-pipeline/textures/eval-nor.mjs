// Normal/diffuse quality sweep: size and mean/p99 angular error (normals), size (diff).
import sharp from 'sharp';
import path from 'node:path';
import { loadPlanes, normalToRGB8, packRGB8, rawOpts } from './lib.mjs';
const W = 2048, n = W * W;
const tot = {};
for (const set of process.argv.slice(2)) {
  const nor = await loadPlanes(path.join('raw', set, 'nor_gl.png'));
  const ref = normalToRGB8(nor.planes, W, W, W);
  const line = [];
  for (const q of [80, 85, 92]) {
    const b = await sharp(ref, rawOpts(W)).webp({ quality: q, smartSubsample: true, effort: 6 }).toBuffer();
    const d = await sharp(b).removeAlpha().raw().toBuffer();
    let s = 0; const e = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = [0, 1, 2].map((k) => ref[i * 3 + k] / 127.5 - 1), c = [0, 1, 2].map((k) => d[i * 3 + k] / 127.5 - 1);
      e[i] = Math.acos(Math.min(1, (a[0] * c[0] + a[1] * c[1] + a[2] * c[2]) / (Math.hypot(...a) * Math.hypot(...c)))) * 57.3; s += e[i];
    }
    e.sort(); tot['n' + q] = (tot['n' + q] || 0) + b.length;
    line.push(`q${q} ${(b.length / 1e6).toFixed(2)}MB ${(s / n).toFixed(2)}°/${e[Math.floor(n * 0.99)].toFixed(1)}°`);
  }
  const df = (await sharp(path.join('raw', set, set === 'marble' ? 'diff.png' : 'diff.jpg')).raw().toBuffer());
  for (const q of [80, 85]) { const b = await sharp(df, rawOpts(W)).webp({ quality: q, smartSubsample: true, effort: 6 }).toBuffer(); tot['d' + q] = (tot['d' + q] || 0) + b.length; line.push(`diff q${q} ${(b.length / 1e6).toFixed(2)}MB`); }
  console.log(set.padEnd(11), line.join(' | '));
}
console.log(Object.entries(tot).map(([k, v]) => `${k} ${(v / 1e6).toFixed(2)}MB`).join(' | '));
