// Build labelled grids of candidate thumbnails per set for visual review.
import sharp from 'sharp';
import fs from 'node:fs';
const cands = JSON.parse(fs.readFileSync('candidates.json', 'utf8'));
const T = 256, L = 22, COLS = 6;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
for (const [set, ids] of Object.entries(cands)) {
  const rows = Math.ceil(ids.length / COLS);
  const comps = [];
  for (let i = 0; i < ids.length; i++) {
    const x = (i % COLS) * T, y = Math.floor(i / COLS) * (T + L);
    const img = await sharp(`thumbs/${ids[i]}.png`).resize(T, T).flatten({ background: '#000' }).toBuffer();
    comps.push({ input: img, left: x, top: y + L });
    const svg = `<svg width="${T}" height="${L}"><rect width="100%" height="100%" fill="#222"/><text x="4" y="16" font-family="Arial" font-size="15" fill="#fff">${esc(ids[i])}</text></svg>`;
    comps.push({ input: Buffer.from(svg), left: x, top: y });
  }
  await sharp({ create: { width: COLS * T, height: rows * (T + L), channels: 3, background: '#000' } })
    .composite(comps).jpeg({ quality: 85 }).toFile(`grid_${set}.jpg`);
  console.log(set, ids.length);
}
