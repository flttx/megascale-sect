// Lit preview grid (diff shaded by 1K normal, light from upper-left), 2x2 tiled, for candidate comparison.
import sharp from 'sharp';
const [,, out, ...ids] = process.argv;
const T = 384, LB = 22, COLS = 3, S = 1024, L = [-0.55, 0.45, 0.7], ll = Math.hypot(...L);
const comps = [];
for (const [idx, id] of ids.entries()) {
  const d = await sharp(`prev1k/${id}.jpg`).resize(S, S).removeAlpha().raw().toBuffer();
  const n = await sharp(`prevnor/${id}.jpg`).resize(S, S).removeAlpha().raw().toBuffer();
  const o = Buffer.alloc(S * S * 3);
  for (let i = 0; i < S * S; i++) {
    const v = [n[i * 3] / 127.5 - 1, n[i * 3 + 1] / 127.5 - 1, n[i * 3 + 2] / 127.5 - 1];
    const k = 0.25 + 1.1 * Math.max(0, (v[0] * L[0] + v[1] * L[1] + v[2] * L[2]) / (ll * Math.hypot(...v)));
    for (let c = 0; c < 3; c++) o[i * 3 + c] = Math.min(255, d[i * 3 + c] * k);
  }
  const half = await sharp(o, { raw: { width: S, height: S, channels: 3 } }).resize(T / 2, T / 2).png().toBuffer();
  const x = (idx % COLS) * T, y = Math.floor(idx / COLS) * (T + LB);
  for (let k = 0; k < 4; k++) comps.push({ input: half, left: x + (k % 2) * T / 2, top: y + LB + Math.floor(k / 2) * T / 2 });
  comps.push({ input: Buffer.from(`<svg width="${T}" height="${LB}"><rect width="100%" height="100%" fill="#222"/><text x="4" y="16" font-family="Arial" font-size="15" fill="#fff">${id} (lit, 2x2)</text></svg>`), left: x, top: y });
}
await sharp({ create: { width: COLS * T, height: Math.ceil(ids.length / COLS) * (T + LB), channels: 3, background: '#000' } }).composite(comps).jpeg({ quality: 88 }).toFile(out);
