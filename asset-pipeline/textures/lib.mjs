// Shared image helpers: 16-bit-aware channel loading, box downsampling, normal renormalisation.
import sharp from 'sharp';

/** Load an image as Float32 planes in [0,1] (alpha dropped). Works for 8/16-bit, grey/rgb. */
export async function loadPlanes(file) {
  const { data, info } = await sharp(file)
    .pipelineColourspace('rgb16')
    .toColourspace('rgb16')
    .raw({ depth: 'ushort' })
    .toBuffer({ resolveWithObject: true });
  const u = new Uint16Array(data.buffer, data.byteOffset, data.length / 2);
  const { width: w, height: h, channels: c } = info;
  const n = w * h;
  const planes = [0, 1, 2].map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    planes[0][i] = u[i * c] / 65535;
    planes[1][i] = u[i * c + 1] / 65535;
    planes[2][i] = u[i * c + 2] / 65535;
  }
  return { w, h, planes };
}

/** Exact 2:1 box downsample of a Float32 plane (tile-safe: no cross-edge filtering needed). */
export function half(plane, w, h) {
  const w2 = w >> 1, h2 = h >> 1;
  const out = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      const i = 2 * y * w + 2 * x;
      out[y * w2 + x] = (plane[i] + plane[i + 1] + plane[i + w] + plane[i + w + 1]) * 0.25;
    }
  }
  return out;
}

/** Downsample by powers of two until width === target. */
export function downTo(plane, w, h, target) {
  let p = plane, cw = w, ch = h;
  while (cw > target) {
    p = half(p, cw, ch);
    cw >>= 1;
    ch >>= 1;
  }
  return p;
}

/**
 * Decode tangent-space normal planes ([0,1] encoded) to unit vectors, optionally downsample
 * (averaging vectors, then renormalising), and re-encode to interleaved RGB uint8.
 */
export function normalToRGB8(planes, w, h, target, flipGreen = false) {
  let x = planes[0].map((v) => v * 2 - 1);
  let y = planes[1].map((v) => (flipGreen ? -1 : 1) * (v * 2 - 1));
  let z = planes[2].map((v) => v * 2 - 1);
  x = downTo(x, w, h, target);
  y = downTo(y, w, h, target);
  z = downTo(z, w, h, target);
  const n = target * target;
  const out = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    let zx = x[i], zy = y[i], zz = Math.max(z[i], 1e-4);
    const len = Math.hypot(zx, zy, zz) || 1;
    zx /= len; zy /= len; zz /= len;
    out[i * 3] = Math.round((zx * 0.5 + 0.5) * 255);
    out[i * 3 + 1] = Math.round((zy * 0.5 + 0.5) * 255);
    out[i * 3 + 2] = Math.round((zz * 0.5 + 0.5) * 255);
  }
  return out;
}

/** Interleave up to 3 float planes (or constants) into RGB uint8. */
export function packRGB8(r, g, b, n) {
  const out = Buffer.alloc(n * 3);
  const at = (p, i) => (typeof p === 'number' ? p : p[i]);
  for (let i = 0; i < n; i++) {
    out[i * 3] = Math.round(Math.min(1, Math.max(0, at(r, i))) * 255);
    out[i * 3 + 1] = Math.round(Math.min(1, Math.max(0, at(g, i))) * 255);
    out[i * 3 + 2] = Math.round(Math.min(1, Math.max(0, at(b, i))) * 255);
  }
  return out;
}

/** Percentile-stretch a plane to [0,1]; returns { plane, lo, hi }. */
export function stretch(plane, pLo = 0.001, pHi = 0.999) {
  const hist = new Uint32Array(4096);
  for (const v of plane) hist[Math.min(4095, Math.floor(v * 4096))]++;
  const n = plane.length;
  let acc = 0, lo = 0, hi = 1;
  for (let i = 0; i < 4096; i++) {
    acc += hist[i];
    if (acc >= n * pLo) { lo = i / 4096; break; }
  }
  acc = 0;
  for (let i = 4095; i >= 0; i--) {
    acc += hist[i];
    if (acc >= n * (1 - pHi)) { hi = (i + 1) / 4096; break; }
  }
  const span = Math.max(1e-6, hi - lo);
  return { plane: plane.map((v) => (v - lo) / span), lo, hi };
}

export const rawOpts = (w, channels = 3) => ({ raw: { width: w, height: w, channels } });

/**
 * Derive OpenGL (+Y up) tangent normal planes ([0,1]-encoded) from a height plane using a
 * wrap-around central difference (keeps tiling). `strength` scales the height gradient
 * (height units per texel -> slope).
 */
export function heightToNormalPlanes(h, w, strength) {
  const n = w * w;
  const px = new Float32Array(n), py = new Float32Array(n), pz = new Float32Array(n);
  for (let y = 0; y < w; y++) {
    const up = ((y - 1 + w) % w) * w, dn = ((y + 1) % w) * w, row = y * w;
    for (let x = 0; x < w; x++) {
      const l = (x - 1 + w) % w, r = (x + 1) % w;
      const dx = (h[row + r] - h[row + l]) * 0.5 * strength;
      const dyUp = (h[up + x] - h[dn + x]) * 0.5 * strength; // image rows run downward, +Y is up
      const len = Math.hypot(dx, dyUp, 1);
      px[row + x] = (-dx / len) * 0.5 + 0.5;
      py[row + x] = (-dyUp / len) * 0.5 + 0.5;
      pz[row + x] = (1 / len) * 0.5 + 0.5;
    }
  }
  return [px, py, pz];
}

/** Separable wrap-around box blur (radius r, `passes` iterations ~ gaussian). Keeps tiling. */
export function blurWrap(src, w, r, passes = 2) {
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  const k = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < w; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += a[row + ((x + d + w) % w)];
        b[row + x] = s * k;
      }
    }
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += b[((y + d + w) % w) * w + x];
        a[y * w + x] = s * k;
      }
    }
  }
  return a;
}
