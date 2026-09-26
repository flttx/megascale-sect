// Flat diffuse preview grid; each tile shown 2x2 tiled to reveal seams/repetition.
import sharp from 'sharp';
const [,, out, ...ids] = process.argv;
const T = 384, L = 22, COLS = 3;
const comps = [];
for (let i = 0; i < ids.length; i++) {
  const x = (i % COLS) * T, y = Math.floor(i / COLS) * (T + L);
  const half = await sharp(`prev1k/${ids[i]}.jpg`).resize(T / 2, T / 2).toBuffer();
  const tile = await sharp({ create: { width: T, height: T, channels: 3, background: '#000' } })
    .composite([0, 1, 2, 3].map((k) => ({ input: half, left: (k % 2) * T / 2, top: Math.floor(k / 2) * T / 2 }))).png().toBuffer();
  comps.push({ input: tile, left: x, top: y + L });
  comps.push({ input: Buffer.from(`<svg width="${T}" height="${L}"><rect width="100%" height="100%" fill="#222"/><text x="4" y="16" font-family="Arial" font-size="15" fill="#fff">${ids[i]} (2x2)</text></svg>`), left: x, top: y });
}
const rows = Math.ceil(ids.length / COLS);
await sharp({ create: { width: COLS * T, height: rows * (T + L), channels: 3, background: '#000' } }).composite(comps).jpeg({ quality: 85 }).toFile(out);
