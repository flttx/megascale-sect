// Contact sheet: node sheet.mjs out.png height img1 img2 ...
import sharp from 'sharp'

const [out, h, ...files] = process.argv.slice(2)
const H = Number(h)
const imgs = await Promise.all(files.map((f) => sharp(f).resize({ height: H }).toBuffer({ resolveWithObject: true })))
let x = 0
const comp = imgs.map(({ data, info }) => { const r = { input: data, left: x, top: 0 }; x += info.width + 6; return r })
await sharp({ create: { width: x, height: H, channels: 3, background: '#ffffff' } }).composite(comp).png().toFile(out)
console.log(out, x, 'x', H)
