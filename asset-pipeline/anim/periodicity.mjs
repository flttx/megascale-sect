// Glitch + period detection: per-frame max bone angular step, and best loop windows.
import { io, skeletonOf, sampleAnimation } from './lib.mjs'
const [file, minP = '10', maxP = '200'] = process.argv.slice(2)
const doc = await io.read(file)
const skel = skeletonOf(doc)
const s = sampleAnimation(doc, doc.getRoot().listAnimations()[0], skel)
const bones = skel.order.filter((n) => !/Twist|Root/.test(n))
const dist = (i, j) => { let d = 0; for (const b of bones) d = Math.max(d, s.local[i].get(b).r.angleTo(s.local[j].get(b).r)); return d * 57.3 }
const steps = []
for (let f = 1; f < s.frames; f++) steps.push(dist(f - 1, f))
console.log('frames', s.frames, 'step° per frame:', steps.map((v) => v.toFixed(0)).join(' '))
const best = []
for (let a = 0; a < s.frames; a++) for (let p = +minP; p <= +maxP && a + p < s.frames; p++) best.push({ a, p, d: dist(a, a + p) })
best.sort((x, y) => x.d - y.d)
console.log('best windows (start, period, maxdeg):', best.slice(0, 15).map((b) => `${b.a}+${b.p}:${b.d.toFixed(1)}`).join('  '))
