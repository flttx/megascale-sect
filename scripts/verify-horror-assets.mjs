import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import { openWorld, review } from './lib/world-session.mjs'
import { creatureView } from './lib/eldritch-views.mjs'

const OUT = 'artifacts/horror-creatures'
const report = { checks: [], assets: {}, views: [], errors: [], failure: null }
const check = (label, value) => {
  assert.ok(value, label)
  report.checks.push(label)
  console.log('PASS', label)
}
const hash = (data) => createHash('sha256').update(data).digest('hex')
await fs.mkdir(OUT, { recursive: true })
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const records = JSON.parse(await fs.readFile('asset-pipeline/black-mist/horror-generations.json', 'utf8'))
const metadata = JSON.parse(await fs.readFile('asset-pipeline/black-mist/horror-assets.json', 'utf8'))
check(
  'exactly two approved generations succeeded for 100 total credits',
  records.tasks.length === 2 &&
    records.actualTotalCredits === 100 &&
    records.tasks.every(
      (task) =>
        task.status === 'success' &&
        task.type === 'text_to_model' &&
        task.credits_consumed === 50 &&
        task.input.model_version === 'v3.1-20260211' &&
        task.input.geometry_quality === 'detailed' &&
        task.input.pbr === true,
    ),
)
for (const id of ['watcher', 'behemoth']) {
  const asset = metadata[id],
    task = records.tasks.find((item) => item.asset === id)
  check(
    `${id} metadata retains its real generated anatomy`,
    asset.sourceStats.triangles > 70000 &&
      asset.sourceStats.materials.every(
        (material) => material.pbr.baseColor && material.pbr.normal && material.pbr.roughness,
      ),
  )
  const raw = await fs.readFile(asset.source).catch(() => null)
  if (raw)
    check(
      `${id} source matches the approved generation`,
      hash(raw) === asset.sha256 && asset.source.startsWith(task.sourceDirectory),
    )
  const levels = []
  for (let level = 0; level < asset.lods.length; level++) {
    const lod = asset.lods[level],
      bytes = await fs.readFile(lod.file),
      doc = await io.readBinary(bytes),
      root = doc.getRoot()
    const sourceScene = root.getDefaultScene() ?? root.listScenes()[0],
      bounds = getBounds(sourceScene)
    const triangles = root
      .listMeshes()
      .flatMap((mesh) => mesh.listPrimitives())
      .reduce((sum, part) => sum + part.getIndices().getCount() / 3, 0)
    const size = bounds.max.map((value, index) => value - bounds.min[index])
    check(
      `${id}/LOD${level} has authenticated non-flat actual geometry`,
      hash(bytes) === lod.sha256 && triangles === lod.triangles && Math.min(...size) > 0.2,
    )
    check(
      `${id}/LOD${level} has actual color, normal and roughness maps`,
      root
        .listMaterials()
        .every(
          (material) =>
            material.getBaseColorTexture() && material.getNormalTexture() && material.getMetallicRoughnessTexture(),
        ),
    )
    const textures = []
    for (const texture of root.listTextures()) {
      const data = texture.getImage(),
        image = await sharp(data).metadata()
      check(
        `${id}/LOD${level} retains ${level ? '1K' : '4K'} embedded maps`,
        image.width === (level ? 1024 : 4096) && image.height === image.width,
      )
      textures.push({ name: texture.getName(), width: image.width, height: image.height })
    }
    levels.push({ triangles, bytes: bytes.length, size, textures })
  }
  check(
    `${id} distant model reduces anatomy and texture cost`,
    levels[1].triangles < levels[0].triangles * 0.55 && levels[1].bytes < levels[0].bytes * 0.4,
  )
  report.assets[id] = levels
}
if (process.argv.includes('--assets-only')) {
  await fs.writeFile(`${OUT}/asset-report.json`, JSON.stringify(report, null, 2) + '\n')
} else {
  const { browser, page, errors } = await openWorld('?quality=high&hours=15&weather=clear', {
    width: 1600,
    height: 900,
  })
  report.errors = errors
  const baseCreatures = (state) =>
    state.creatures.filter((creature) => creature.id === 'watcher' || creature.id === 'behemoth')
  try {
    await page.evaluate(() => {
      window.__blackMist.reset()
      window.__blackMist.hold(true)
    })
    await page.waitForFunction(() => window.__blackMist.snapshot().assets.ready, null, { timeout: 70000 })
    for (const [time, name] of [
      [36, 'watcher-apparition'],
      [39, 'behemoth-apparition'],
    ]) {
      await page.evaluate((time) => window.__blackMist.seek(time), time)
      await page.waitForTimeout(350)
      const state = await page.evaluate(() => window.__blackMist.snapshot())
      check(
        `${name} cinematic reveals the actual new creature`,
        state.cameraShot.id === name &&
          baseCreatures(state).length === 2 &&
          baseCreatures(state).every(
            (creature) =>
              creature.visible &&
              creature.draws.every((draw) => draw.pbr.baseColor && draw.pbr.normal && draw.pbr.roughness),
          ),
      )
      await page.screenshot({ path: `${OUT}/${name}.png` })
    }
    await page.evaluate(() => {
      window.__blackMist.skip()
      window.__blackMist.hold(true)
      window.__ui.setHudHidden(true)
    })
    for (const quality of ['high', 'mid', 'low']) {
      await page.evaluate(async (quality) => {
        const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
        useWorldStore.getState().setQuality(quality, false)
      }, quality)
      for (const [id, pose] of Object.entries({
        watcher: null,
        behemoth: null,
        distant: [
          [-2800, 1200, 2400],
          [0, 250, -800],
        ],
      })) {
        const placed =
          id === 'distant'
            ? null
            : (await page.evaluate(() => window.__blackMist.snapshot())).creatures.find(
                (creature) => creature.id === id,
              )
        await review(page, placed ? creatureView(placed) : pose, 1000)
        const state = await page.evaluate(() => window.__blackMist.snapshot()),
          telemetry = await page.evaluate(() => window.__playerSnapshot().telemetry)
        check(
          `${quality}/${id} preserves both immense organisms and the draw budget`,
          baseCreatures(state).length === 2 &&
            baseCreatures(state).every(
              (creature) =>
                creature.visible &&
                creature.reveal === 1 &&
                creature.draws.every((draw) => draw.triangles > 20000 && (draw.motionPatched ?? draw.breathingPatched)),
            ) &&
            telemetry.drawCalls <= 400,
        )
        if (quality === 'low' || id === 'distant')
          check(
            `${quality}/${id} uses reduced creature LODs`,
            baseCreatures(state).every((creature) => creature.lod === 1),
          )
        if (quality === 'high' && id !== 'distant') await page.screenshot({ path: `${OUT}/${id}-detail.png` })
        report.views.push({ quality, id, drawCalls: telemetry.drawCalls, creatures: state.creatures })
      }
    }
    check('new creature materials and anatomy render without shader or browser errors', errors.length === 0)
  } catch (error) {
    report.failure = error.stack
    throw error
  } finally {
    await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + '\n')
    await browser.close()
  }
}
