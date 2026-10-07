import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Logger, NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import sharp from 'sharp'
import { openWorld, installLiveImports, review } from './lib/world-session.mjs'
import { tentacleView } from './lib/eldritch-views.mjs'

// Verifies the delivered Tripo GLBs and their actual rendered materials, not a procedural placeholder.
// Use --assets-only to inspect local provenance, geometry, maps and LODs without launching Chrome.
// The full run follows BASE_URL / CHROME_PATH and captures the eye, suction cups and sect skyline.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'artifacts/eldritch-assets')
const IDS = ['eye', 'tentacle']
const QUALITIES = ['high', 'mid', 'low']
const viewport = { width: 1600, height: 900 }
const VIEWS = {
  eye: [
    [0, 570, -120],
    [0, 550, -430],
  ],
  tentacle: null,
  wide: [
    [-780, 640, 900],
    [0, 260, -380],
  ],
  distant: [
    [-2800, 1200, 2400],
    [0, 260, -380],
  ],
}
const publicUrl = (id, lod) => `/assets/black-mist/abyss-${id}${lod ? '.lod1' : ''}.glb`
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const report = { checks: [], assets: {}, browser: { requests: [], views: [], errors: [] }, failure: null }
const check = (label, condition) => {
  assert.ok(condition, label)
  report.checks.push(label)
  console.log('PASS', label)
}
await fs.mkdir(OUT, { recursive: true })
await MeshoptDecoder.ready
const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.WARN))
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

async function inspectGlb(file) {
  const bytes = await fs.readFile(file)
  check(
    `${path.basename(file)} is a binary glTF 2 asset`,
    bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2,
  )
  const doc = await io.readBinary(bytes),
    root = doc.getRoot()
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  assert.ok(scene, `${file} must contain a scene`)
  const bounds = getBounds(scene),
    size = bounds.max.map((value, index) => value - bounds.min[index])
  const primitives = root
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .map((primitive) => {
      const position = primitive.getAttribute('POSITION'),
        normal = primitive.getAttribute('NORMAL'),
        uv = primitive.getAttribute('TEXCOORD_0')
      const material = primitive.getMaterial()
      assert.ok(
        position && normal && uv && material,
        `${file}: imported geometry requires position, normal, UV and material`,
      )
      assert.equal(primitive.getMode(), 4, `${file}: delivered creature geometry uses triangles`)
      return {
        vertices: position.getCount(),
        triangles: (primitive.getIndices()?.getCount() ?? position.getCount()) / 3,
        material: material.getName(),
        baseColor: !!material.getBaseColorTexture(),
        normal: !!material.getNormalTexture(),
        roughness: !!material.getMetallicRoughnessTexture(),
      }
    })
  const textures = []
  for (const texture of root.listTextures()) {
    const image = texture.getImage()
    assert.ok(image?.byteLength, `${file}: textures must be embedded in the GLB`)
    const metadata = await sharp(image).metadata(),
      stats = await sharp(image).stats()
    textures.push({
      name: texture.getName(),
      mimeType: texture.getMimeType(),
      width: metadata.width,
      height: metadata.height,
      bytes: image.byteLength,
      variation: stats.channels.map((channel) => Number(channel.stdev.toFixed(3))),
    })
  }
  return {
    bytes: bytes.byteLength,
    sha256: hash(bytes),
    bounds: { min: bounds.min, max: bounds.max, size },
    meshes: root.listMeshes().length,
    primitives,
    triangles: primitives.reduce((sum, primitive) => sum + primitive.triangles, 0),
    vertices: primitives.reduce((sum, primitive) => sum + primitive.vertices, 0),
    textures,
    materialNames: root.listMaterials().map((material) => material.getName()),
  }
}

async function inspectAssets() {
  const metadata = JSON.parse(await fs.readFile(path.join(ROOT, 'asset-pipeline/black-mist/assets.json'), 'utf8'))
  const generations = JSON.parse(
    await fs.readFile(path.join(ROOT, 'asset-pipeline/black-mist/generations.json'), 'utf8'),
  )
  check(
    'both public creature assets have retained successful Tripo generation records',
    generations.tasks?.length === 2 &&
      new Set(generations.tasks.map((task) => task.task_id)).size === 2 &&
      generations.tasks.every(
        (task) =>
          task.type === 'text_to_model' &&
          task.status === 'success' &&
          /^[a-f0-9-]{36}$/.test(task.task_id) &&
          IDS.includes(task.asset) &&
          task.input?.pbr &&
          task.input.texture &&
          task.input.model_version === generations.model &&
          task.input.texture_version === generations.textureModel,
      ),
  )
  check(
    'generation provenance preserves the actual itemized credit total',
    generations.tasks.reduce((sum, task) => sum + task.credits_consumed, 0) === generations.totalCredits,
  )
  for (const id of IDS) {
    const provenance = metadata[id]
    const generation = generations.tasks.find((task) => task.asset === id)
    assert.ok(generation, `${id}: successful generation task is required`)
    assert.ok(
      provenance && typeof provenance.source === 'string' && /^[a-f0-9]{64}$/.test(provenance.sha256),
      `${id}: source provenance is required`,
    )
    check(
      `${id} preserves its detailed Tripo source identity`,
      provenance.source.includes(`black-mist/tripo-out/abyss-${id}-${generation.task_id.slice(0, 8)}/`) &&
        provenance.sourceTriangles >= 50000,
    )
    const sourceFile = path.resolve(ROOT, provenance.source)
    const sourceBytes = await fs.readFile(sourceFile).catch((error) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (sourceBytes)
      check(`${id} source SHA256 matches the processing manifest`, hash(sourceBytes) === provenance.sha256)
    const lods = []
    for (const lod of [0, 1]) {
      const url = publicUrl(id, lod),
        stats = await inspectGlb(path.join(ROOT, 'public', url.slice(1)))
      const recorded = provenance.lods.find((entry) => entry.file.endsWith(url))
      check(
        `${id} LOD${lod} matches generated output metadata`,
        recorded?.bytes === stats.bytes && recorded?.triangles === stats.triangles,
      )
      check(
        `${id} LOD${lod} has substantial three-dimensional anatomy`,
        stats.triangles >= (lod ? 10000 : 50000) &&
          stats.bounds.size.every((value) => Number.isFinite(value) && value > 0.001),
      )
      check(
        `${id} LOD${lod} contains textured PBR surface detail`,
        stats.primitives.some((primitive) => primitive.baseColor && primitive.normal && primitive.roughness) &&
          stats.textures.length >= 3 &&
          stats.textures.every(
            (texture) => texture.width > 0 && texture.height > 0 && texture.variation.some((value) => value > 0.05),
          ),
      )
      lods.push({ url, ...stats })
    }
    check(
      `${id} close geometry and textures preserve the source sculpt`,
      lods[0].triangles >= provenance.sourceTriangles * 0.95 &&
        lods[0].textures.every((texture) => texture.width >= 2048 && texture.height >= 2048),
    )
    check(
      `${id} delivered textures come from its recorded Tripo task`,
      lods.every((lod) => lod.textures.every((texture) => texture.name.includes(generation.task_id))),
    )
    check(
      `${id} distant geometry reduces triangles without becoming a flat card`,
      lods[1].triangles < lods[0].triangles * 0.65 &&
        lods[1].bounds.size.every((value, index) => Math.abs(value / lods[0].bounds.size[index] - 1) < 0.03),
    )
    check(
      `${id} distant textures fit the 1024 px tier`,
      lods[1].textures.every((texture) => texture.width <= 1024 && texture.height <= 1024),
    )
    report.assets[id] = {
      provenance: {
        source: provenance.source,
        sha256: provenance.sha256,
        sourceTriangles: provenance.sourceTriangles,
        taskId: generation.task_id,
        model: generation.input.model_version,
        textureModel: generation.input.texture_version,
        credits: generation.credits_consumed,
      },
      lods,
    }
  }
}

function assertModelDraws(snapshot, quality, view) {
  assert.ok(Array.isArray(snapshot.models), 'DEV snapshot must expose effectively visible GLB model meshes')
  for (const id of IDS) {
    const models = snapshot.models.filter((model) => model.id === id)
    check(
      `${quality}/${view}: actual ${id} models are visible`,
      models.length > 0 && models.every((model) => snapshot.sceneNames.includes(model.name)),
    )
    for (const model of models) {
      const asset = report.assets[id].lods[model.lod]
      check(
        `${quality}/${view}: ${model.name} renders imported PBR geometry`,
        !!asset &&
          model.sourceUrl.endsWith(asset.url) &&
          asset.primitives.some((primitive) => primitive.triangles === model.triangles) &&
          model.pbr.baseColor &&
          model.pbr.normal &&
          model.pbr.roughness,
      )
    }
  }
}

async function verifyBrowser() {
  const { browser, page, errors } = await openWorld('?quality=high&hours=15&weather=clear', viewport)
  report.browser.errors = errors
  const snapshot = () => page.evaluate(() => window.__blackMist.snapshot())
  const modelRequests = new Set()
  const onRequest = (request) => {
    const url = new URL(request.url()).pathname
    if (/\/assets\/black-mist\/abyss-(eye|tentacle)(\.lod1)?\.glb$/.test(url)) modelRequests.add(url)
  }
  page.on('request', onRequest)
  try {
    const normalResources = await page.evaluate(() =>
      performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname),
    )
    check(
      'normal exploration does not download the mist models',
      !normalResources.some((url) => /\/assets\/black-mist\/abyss-.*\.glb$/.test(url)),
    )
    check('normal exploration contains no imported mist model draws', !(await snapshot()).models?.length)
    await page.evaluate(() => document.exitPointerLock())
    await page.reload({ waitUntil: 'domcontentloaded' })
    await installLiveImports(page)
    await page.waitForFunction(() => document.querySelector('.enter-button')?.disabled === false, null, {
      timeout: 180000,
    })
    check('normal title screen also leaves optional mist assets unloaded', modelRequests.size === 0)
    await page.locator('input[name="world-experience"][value="black-mist"]').check()
    check('choosing the title-screen mode leaves the world timeline inactive', !(await snapshot()).active)
    await page.locator('.enter-button').click()
    await page.waitForFunction(() => window.__blackMist?.snapshot().assets?.ready, null, { timeout: 180000 })
    check(
      'mode entry downloads all four real model LODs',
      IDS.flatMap((id) => [publicUrl(id, 0), publicUrl(id, 1)]).every((url) => modelRequests.has(url)),
    )
    report.browser.requests = [...modelRequests].sort()
    await page.evaluate(() => {
      window.__blackMist.hold(true)
      window.__blackMist.seek(55)
      window.__blackMist.skip()
      window.__blackMist.hold(true)
      window.__ui.setHudHidden(true)
    })
    for (const quality of QUALITIES) {
      await page.evaluate(async (value) => {
        const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
        useWorldStore.getState().setQuality(value, false)
      }, quality)
      for (const [view, pose] of Object.entries(VIEWS)) {
        await review(page, view === 'tentacle' ? tentacleView(await snapshot()) : pose, 1200)
        const state = await snapshot()
        assertModelDraws(state, quality, view)
        if (view === 'distant')
          check(
            `${quality}: distant creatures use LOD1`,
            state.models.every((model) => model.lod === 1),
          )
        if (view === 'eye' && quality !== 'low')
          check(
            `${quality}: close eye retains LOD0`,
            state.models.filter((model) => model.id === 'eye').every((model) => model.lod === 0),
          )
        if (view === 'tentacle' && quality !== 'low')
          check(
            `${quality}: close suction cups retain LOD0`,
            state.models.some((model) => model.id === 'tentacle' && model.lod === 0),
          )
        if (quality === 'low')
          check(
            `low/${view}: low quality uses the bounded LOD1 creature meshes`,
            state.models.every((model) => model.lod === 1),
          )
        const frame = { quality, view, camera: state.camera, models: state.models }
        if (quality === 'high' || view === 'wide') {
          const bytes = await page.screenshot({ path: path.join(OUT, `${quality}-${view}.png`) })
          const {
            channels: [luma],
          } = await sharp(bytes).greyscale().stats()
          frame.luma = { mean: Number(luma.mean.toFixed(1)), stdev: Number(luma.stdev.toFixed(1)) }
          check(
            `${quality}/${view}: the real asset frame has visible depth`,
            luma.mean > 7 && luma.mean < 240 && luma.stdev > 5,
          )
        }
        report.browser.views.push(frame)
      }
    }
    const final = await snapshot()
    check(
      'generated creature meshes replace the procedural eye and suction rings',
      !final.sceneNames.some((name) =>
        /EldritchOcularGlobe|EldritchSuctionRings|EldritchSuctionCavities|EldritchTentacleBodies/.test(name),
      ),
    )
    check('PBR creature assets compile and render without browser or shader errors', errors.length === 0)
  } catch (error) {
    await page.screenshot({ path: path.join(OUT, 'failure.png') }).catch(() => {})
    throw error
  } finally {
    page.off('request', onRequest)
    await browser.close()
  }
}

try {
  await inspectAssets()
  if (!process.argv.includes('--assets-only')) await verifyBrowser()
} catch (error) {
  report.failure = error.stack ?? String(error)
  throw error
} finally {
  await fs.writeFile(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
}
