// Build final WebP maps into public/assets/textures/<set>/ from raw/<set>/ sources.
//   diff.webp   sRGB base colour 2048 (q85)          diff.1k.webp   1024 (linear-light box downsample)
//   nor.webp    OpenGL (+Y) tangent normal 2048       nor.1k.webp    1024 (vector average + renormalise)
//   arm.webp    R=AO G=roughness B=metalness(0) 2048  arm.1k.webp    1024
//   height.webp grayscale 1024 (percentile-stretched) height.1k.webp 512   (cliff, rock_detail, paving)
// All downsampling is exact 2:1 box filtering, so outputs stay seamlessly tileable.
// Usage: node build.mjs [set ...]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { SETS } from './sets.mjs';
import { loadPlanes, downTo, normalToRGB8, packRGB8, stretch, rawOpts, heightToNormalPlanes, blurWrap } from './lib.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const PROJECT = path.resolve(ROOT, '..', '..');
const OUT = path.join(PROJECT, 'public', 'assets', 'textures');
// Only the .1k maps ship (every quality preset samples them); the 2K masters and unshipped sets stay here.
const HI = path.join(ROOT, 'hi');

// Lossy WebP is always YUV 4:2:0: on normals the error is dominated by chroma subsampling, not by
// quality (q80 vs q92 differ < 0.5 deg mean on grass/gravel), so q80 buys budget (total <= 40 MB). ARM is near-lossless because lossy
// leaked metalness (B) up to 0.13 and AO errors up to 100/255; near-lossless keeps B exactly 0.
const ARM_NL = Number(process.env.ARM_NL ?? 20); // max abs error 8/255
export const Q = {
  diff: { quality: 85, smartSubsample: true, effort: 6 },
  nor: { quality: 80, smartSubsample: true, effort: 6 },
  arm: { nearLossless: true, quality: ARM_NL, effort: 6 },
  height: { quality: 90, effort: 6 },
};

const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const find = (dir, base) => ['png', 'jpg'].map((e) => path.join(dir, `${base}.${e}`)).find((f) => fs.existsSync(f));

async function writeWebp(buf, w, channels, opts, file) {
  await sharp(buf, rawOpts(w, channels)).webp(opts).toFile(file);
  return fs.statSync(file).size;
}

async function buildSet(set, cfg) {
  const src = path.join(ROOT, 'raw', set);
  const dst = path.join(cfg.ship === false ? HI : OUT, set), hi = path.join(HI, set);
  fs.mkdirSync(dst, { recursive: true }); fs.mkdirSync(hi, { recursive: true });
  const report = {};
  const W = 2048, W1 = 1024;

  // --- diffuse ---
  const diffFile = find(src, 'diff');
  const diff = await loadPlanes(diffFile);
  if (diff.w !== W || diff.h !== W) throw new Error(`${set}: diff is ${diff.w}x${diff.h}`);
  const d8 = packRGB8(diff.planes[0], diff.planes[1], diff.planes[2], W * W);
  report['diff.webp'] = await writeWebp(d8, W, 3, Q.diff, path.join(hi, 'diff.webp'));
  const d1 = diff.planes.map((p) => downTo(p.map(toLin), W, W, W1).map(toSrgb));
  report['diff.1k.webp'] = await writeWebp(packRGB8(d1[0], d1[1], d1[2], W1 * W1), W1, 3, Q.diff, path.join(dst, 'diff.1k.webp'));

  // --- normal (sources are OpenGL convention: nor_gl / NormalGL; or derived from displacement) ---
  let norPlanes;
  if (cfg.normalFromHeight) {
    const { blur, strength } = cfg.normalFromHeight;
    const disp = (await loadPlanes(find(src, 'disp'))).planes[0];
    norPlanes = heightToNormalPlanes(blur ? blurWrap(disp, W, blur, 2) : disp, W, strength);
  } else {
    norPlanes = (await loadPlanes(find(src, 'nor_gl'))).planes;
  }
  report['nor.webp'] = await writeWebp(normalToRGB8(norPlanes, W, W, W), W, 3, Q.nor, path.join(hi, 'nor.webp'));
  report['nor.1k.webp'] = await writeWebp(normalToRGB8(norPlanes, W, W, W1), W1, 3, Q.nor, path.join(dst, 'nor.1k.webp'));

  // --- ARM ---
  const aoFile = find(src, 'ao');
  const ao = aoFile ? (await loadPlanes(aoFile)).planes[0] : null;
  const rough = (await loadPlanes(find(src, 'rough'))).planes[0];
  report['arm.webp'] = await writeWebp(packRGB8(ao ?? 1, rough, 0, W * W), W, 3, Q.arm, path.join(hi, 'arm.webp'));
  const ao1 = ao ? downTo(ao, W, W, W1) : 1;
  report['arm.1k.webp'] = await writeWebp(packRGB8(ao1, downTo(rough, W, W, W1), 0, W1 * W1), W1, 3, Q.arm, path.join(dst, 'arm.1k.webp'));

  // --- height ---
  let heightRange = null;
  if (cfg.height) {
    const dispFile = find(src, 'disp');
    if (!dispFile) throw new Error(`${set}: height requested but no disp source`);
    const disp = (await loadPlanes(dispFile)).planes[0];
    const { plane, lo, hi } = stretch(disp);
    heightRange = [Number(lo.toFixed(4)), Number(hi.toFixed(4))];
    for (const [name, size] of [['height.webp', 1024], ['height.1k.webp', 512]]) {
      const h = downTo(plane, W, W, size);
      const g = Buffer.alloc(size * size);
      for (let i = 0; i < g.length; i++) g[i] = Math.round(Math.min(1, Math.max(0, h[i])) * 255);
      report[name] = await writeWebp(g, size, 1, Q.height, path.join(name === 'height.webp' ? hi : dst, name));
    }
  }
  return { report, hasAO: !!ao, heightRange };
}

const only = process.argv.slice(2);
const results = {};
for (const [set, cfg] of Object.entries(SETS)) {
  if (only.length && !only.includes(set)) continue;
  const t = Date.now();
  results[set] = await buildSet(set, cfg);
  const total = Object.values(results[set].report).reduce((a, b) => a + b, 0);
  console.log(`[${set}] ${(total / 1e6).toFixed(2)}MB in ${((Date.now() - t) / 1000).toFixed(0)}s`, Object.entries(results[set].report).map(([k, v]) => `${k}=${(v / 1e6).toFixed(2)}`).join(' '));
}
fs.writeFileSync(path.join(ROOT, 'build-report.json'), JSON.stringify(results, null, 2));
