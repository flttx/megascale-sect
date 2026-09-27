import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld } from './lib/world-session.mjs'
const { browser, page, errors } = await openWorld('?quality=low')
try {
  const report = await page.evaluate(async () => {
    const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js')
    const { MeshoptDecoder } = await import('/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js')
    const { PropertyBinding, Quaternion, Vector3 } = await window.__liveImport('/node_modules/.vite/deps/three.js')
    const { ClipLayer } = await window.__liveImport('/src/world/player/characterClips.ts')
    const { CHARACTER_ASSETS } = await window.__liveImport('/src/world/player/characterAssets.ts')
    const { createPlayerRuntime, stepPlayer } = await window.__liveImport('/src/world/player/playerMotion.ts')
    const { registerWalkables } = await window.__liveImport('/src/world/surfaces.ts')
    const report = []
    for (const character of ['male', 'female']) {
      const config = CHARACTER_ASSETS[character], gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(config.anim)
      const targets = new Map()
      for (const clip of gltf.animations) for (const track of clip.tracks) {
        const nodeName = PropertyBinding.parseTrackName(track.name).nodeName, name = nodeName.replace(/^mixamorig[:_]?/, '')
        const node = gltf.scene.getObjectByName(nodeName)
        if (!targets.has(name)) targets.set(name, { rest: node?.quaternion.clone() ?? new Quaternion(), restPosition: node?.position.clone() ?? new Vector3(), rotation: new Quaternion(), position: new Vector3(), rotationWeight: 0, positionWeight: 0 })
      }
      for (const fps of [60, 144]) {
        const layer = new ClipLayer(targets, gltf.animations, config.gaits), r = createPlayerRuntime()
        const off = registerWalkables([
          { kind: 'disc', x: 2000, z: 2000, y: 500, radius: 20 },
          { kind: 'span', from: [2000, 501.2, 2000], to: [2000, 501.2, 1992], halfWidth: 3, sag: 0 },
        ])
        r.ready = true; r.position.set(2000, 500, 2002); r.velocity.z = -5.5; r.jumpBuffer = 0.15
        let last = null, landed = false, wasAir = false, nearLanding = null
        try {
          for (let n = 0; n < fps; n++) {
            stepPlayer(r, new Vector3(0, 0, -1), false, 1 / fps); layer.update(r, 1 / fps)
            if (wasAir && !r.inAir) { landed = true; nearLanding = last; break }
            wasAir = r.inAir; last = { y: r.position.y, vy: r.velocity.y, ...layer.snapshot() }
          }
          // Immediately start another jump while the first reaching pose still has weight.
          const previous = [...targets.values()].map((t) => t.rotation.clone())
          r.jumpBuffer = 0.15
          stepPlayer(r, new Vector3(), false, 1 / fps); layer.update(r, 1 / fps)
          const angle = Math.max(...[...targets.values()].map((t, i) => previous[i].angleTo(t.rotation)))
          report.push({ character, fps, landed, y: r.position.y, nearLanding, fade: layer.snapshot().jumpFade, angle })
        } finally { off() }
      }
    }
    return report
  })
  for (const r of report) {
    assert.ok(r.landed && r.y >= 501.2, 'jump onto 1.2 m platform')
    assert.ok(r.nearLanding.jumpTime > 0.44, `legs reach before raised touchdown: ${JSON.stringify(r)}`)
    assert.ok(r.fade > 0 && r.fade < 0.3 && r.angle > 1e-4 && r.angle < 0.6, `consecutive jump pose blends: ${JSON.stringify(r)}`)
    console.log('PASS raised platform and consecutive jump', r.character, r.fps, r.nearLanding.jumpTime, r.angle)
  }
  assert.deepEqual(errors, [])
  await fs.mkdir('artifacts/jumps', { recursive: true })
  await fs.writeFile('artifacts/jumps/report.json', JSON.stringify(report, null, 2))
} finally { await browser.close() }
