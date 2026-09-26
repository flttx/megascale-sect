// Bark: Poly Haven "Pine Bark" (CC0, Dimitrios Savva) 1k, pulled from red-brown toward the dark
// grey-brown of Pinus hwangshanensis. Writes PNGs next to the sources for the Blender build.
import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'textures')
await sharp(path.join(dir, 'pine_bark_diff_1k.jpg'))
  .modulate({ brightness: 0.6, saturation: 0.38, hue: -8 })
  .linear(1.12, -10) // a touch more contrast in the fissures
  .png()
  .toFile(path.join(dir, 'bark_basecolor.png'))
await sharp(path.join(dir, 'pine_bark_nor_gl_1k.jpg')).png().toFile(path.join(dir, 'bark_normal.png'))
console.log('bark textures ready')
