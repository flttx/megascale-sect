// Compare WebP encodings for normal and ARM maps: size vs error (angular for normals).
import sharp from 'sharp';
import path from 'node:path';
import { loadPlanes, normalToRGB8, packRGB8, rawOpts } from './lib.mjs';

const sets = process.argv.slice(2).length ? process.argv.slice(2) : ['cliff', 'grass', 'paving'];
const variants = {
  'lossy q92': { quality: 92, smartSubsample: true, effort: 5 },
  'lossy q95': { quality: 95, smartSubsample: true, effort: 5 },
  'lossy q100': { quality: 100, smartSubsample: true, effort: 5 },
  'nearLossless q60': { nearLossless: true, quality: 60, effort: 5 },
  'nearLossless q80': { nearLossless: true, quality: 80, effort: 5 },
  lossless: { lossless: true, effort: 5 },
};

function angErr(a, b, n) {
  const errs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = [0, 1, 2].map((k) => a[i * 3 + k] / 127.5 - 1);
    const u = [0, 1, 2].map((k) => b[i * 3 + k] / 127.5 - 1);
    const lv = Math.hypot(...v), lu = Math.hypot(...u);
    const d = (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / (lv * lu);
    errs[i] = (Math.acos(Math.min(1, Math.max(-1, d))) * 180) / Math.PI;
  }
  errs.sort();
  let s = 0;
  for (const e of errs) s += e;
  return { mean: s / n, p99: errs[Math.floor(n * 0.99)] };
}

function absErr(a, b, n, ch) {
  let s = 0, mx = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i * 3 + ch] - b[i * 3 + ch]);
    s += d;
    if (d > mx) mx = d;
  }
  return { mean: s / n, max: mx };
}

for (const set of sets) {
  const dir = path.join('raw', set);
  const nor = await loadPlanes(path.join(dir, 'nor_gl.png'));
  const W = 2048, n = W * W;
  const ref = normalToRGB8(nor.planes, nor.w, nor.h, W);
  const ao = await loadPlanes(path.join(dir, 'ao.png'));
  const ro = await loadPlanes(path.join(dir, 'rough.png'));
  const arm = packRGB8(ao.planes[0], ro.planes[0], 0, n);
  console.log(`== ${set}`);
  for (const [name, opt] of Object.entries(variants)) {
    const bufN = await sharp(ref, rawOpts(W)).webp(opt).toBuffer();
    const decN = await sharp(bufN).removeAlpha().raw().toBuffer();
    const eN = angErr(ref, decN, n);
    const bufA = await sharp(arm, rawOpts(W)).webp(opt).toBuffer();
    const decA = await sharp(bufA).removeAlpha().raw().toBuffer();
    const eR = absErr(arm, decA, n, 0), eG = absErr(arm, decA, n, 1), eB = absErr(arm, decA, n, 2);
    console.log(
      `${name.padEnd(18)} nor ${(bufN.length / 1e6).toFixed(2)}MB mean ${eN.mean.toFixed(2)}° p99 ${eN.p99.toFixed(2)}° | ` +
        `arm ${(bufA.length / 1e6).toFixed(2)}MB AO ${eR.mean.toFixed(2)}/${eR.max} R ${eG.mean.toFixed(2)}/${eG.max} B ${eB.mean.toFixed(2)}/${eB.max}`,
    );
  }
}
