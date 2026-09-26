// ARM encoding sweep (size vs max error per channel) at 2K and 1K.
import sharp from 'sharp';
import path from 'node:path';
import { loadPlanes, packRGB8, downTo, rawOpts } from './lib.mjs';
const variants = { nl20: { nearLossless: true, quality: 20, effort: 6 }, nl40: { nearLossless: true, quality: 40, effort: 6 }, nl60: { nearLossless: true, quality: 60, effort: 6 } };
let tot = {};
for (const set of process.argv.slice(2)) {
  const ao = (await loadPlanes(path.join('raw', set, 'ao.png'))).planes[0];
  const ro = (await loadPlanes(path.join('raw', set, 'rough.png'))).planes[0];
  for (const W of [2048, 1024]) {
    const arm = packRGB8(downTo(ao, 2048, 2048, W), downTo(ro, 2048, 2048, W), 0, W * W);
    const line = [];
    for (const [k, o] of Object.entries(variants)) {
      const b = await sharp(arm, rawOpts(W)).webp(o).toBuffer();
      const d = await sharp(b).removeAlpha().raw().toBuffer();
      const mx = [0, 0, 0]; for (let i = 0; i < arm.length; i++) mx[i % 3] = Math.max(mx[i % 3], Math.abs(arm[i] - d[i]));
      tot[k] = (tot[k] || 0) + b.length;
      line.push(`${k} ${(b.length / 1e6).toFixed(2)}MB max ${mx.join('/')}`);
    }
    console.log(set.padEnd(11), W, line.join(' | '));
  }
}
console.log(Object.entries(tot).map(([k, v]) => `${k} total ${(v / 1e6).toFixed(2)}MB`).join(' | '));
