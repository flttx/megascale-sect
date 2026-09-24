// Tripo prop pipeline: concept image (text-to-image) → image-to-model (fallback text-to-model) → gltf-transform optimize.
// Usage: node scripts/tripo/generate.mjs [--only id1,id2] [--force] [--optimize-only]
//   --force          regenerate even if the asset is already in manifest.lock.json
//   --optimize-only  re-run only the optimize step from asset-pipeline/tripo/<id>/raw.glb
import fs from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO, getBounds, Logger } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, weld, center, simplify, textureCompress, meshopt, prune } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { createTask, waitTask, download, balance, outputUrl, redact } from './client.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MANIFEST = path.join(ROOT, 'scripts/tripo/manifest.json')
const LOCK = path.join(ROOT, 'scripts/tripo/manifest.lock.json')
const WORK_DIR = path.join(ROOT, 'asset-pipeline/tripo')
const OUT_DIR = path.join(ROOT, 'public/assets/props')
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')

const IMAGE_MODEL = 'seedream_v5'
const MODEL_VERSION = 'v3.1-20260211'
// Newest texture model (supports delight = strip baked lighting). Set TRIPO_TEXTURE_VERSION= (empty) to use the default.
const TEXTURE_VERSION = process.env.TRIPO_TEXTURE_VERSION ?? 'v3.5-20260815'
const MAX_3D = 6
const STYLE = 'single isolated object, centered, full view, 3/4 angle, plain light grey background, no ground, no text, Chinese xianxia fantasy, white jade and pale stone with brushed gold trim and deep navy/indigo accents, weathered, high detail, soft studio light'
const CRAFTED = 'white jade and pale stone with brushed gold trim and deep navy/indigo accents'
const NATURAL = 'natural realistic colours with subtle cool mist-white and indigo tones'
const styleFor = (entry) => (entry.palette === 'natural' ? STYLE.replace(CRAFTED, NATURAL) : STYLE)
const RETRY_HINT = 'solid three-dimensional object with full volume and thickness, sharp silhouette, clearly separated from the background'

// ---------- CLI ----------
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const onlyArg = argv.find((a, i) => argv[i - 1] === '--only' || a.startsWith('--only='))
const only = onlyArg ? onlyArg.replace(/^--only=/, '').split(',').map((s) => s.trim()).filter(Boolean) : []
const FORCE = flag('--force')
const OPTIMIZE_ONLY = flag('--optimize-only')

// ---------- helpers ----------
const ts = () => new Date().toISOString().slice(11, 19)
const log = (id, msg) => console.log(`[${ts()}] ${String(id).padEnd(19)} ${redact(msg)}`)
function semaphore(n) {
  let free = n
  const queue = []
  return async (fn) => {
    if (free > 0) free--
    else await new Promise((resolve) => queue.push(resolve))
    try { return await fn() } finally {
      const next = queue.shift()
      if (next) next()
      else free++
    }
  }
}
const imageSlot = semaphore(1)
const modelSlot = semaphore(MAX_3D)
const optimizeSlot = semaphore(2)

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const lock = existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, 'utf8')) : {}
lock.assets ??= {}
lock.failures ??= {}
lock.runs ??= []
const saveLock = () => writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`)

const readState = (dir) => (existsSync(path.join(dir, 'tasks.json')) ? JSON.parse(readFileSync(path.join(dir, 'tasks.json'), 'utf8')) : {})
const writeState = (dir, state) => writeFileSync(path.join(dir, 'tasks.json'), `${JSON.stringify(state, null, 2)}\n`)
const slimTask = (t) => ({ task_id: t.task_id, type: t.type, status: t.status, credits_consumed: t.credits_consumed ?? 0, created_at: t.created_at, completed_at: t.completed_at })

// ---------- gltf-transform ----------
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
})
const triangles = (doc) => doc.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives()
  .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0)
const round = (v) => Math.round(v * 1000) / 1000
function bboxOf(doc) {
  const b = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0])
  return { min: b.min.map(round), max: b.max.map(round), size: b.max.map((v, i) => round(v - b.min[i])) }
}

/** LOD0 keeps full Tripo detail; LOD1 (if lod1Ratio) is simplified with small textures. Base sits at y=0, centred on x/z. */
async function optimize(entry, rawPath) {
  const base = entry.texBase ?? 1024
  const lods = [{ key: 'lod0', file: `${entry.id}.glb`, ratio: 1, error: 0, base, detail: base >= 2048 ? 1024 : 512 }]
  if (entry.lod1Ratio) lods.push({ key: 'lod1', file: `${entry.id}.lod1.glb`, ratio: entry.lod1Ratio, error: 0.02, base: base >= 2048 ? 512 : 256, detail: 256 })
  const rawBytes = await fs.readFile(rawPath)
  const result = { raw: { path: rel(rawPath), bytes: rawBytes.byteLength, triangles: triangles(await io.readBinary(rawBytes)) } }
  await fs.mkdir(OUT_DIR, { recursive: true })
  for (const lod of lods) {
    const doc = await io.readBinary(rawBytes)
    const steps = [dedup(), weld(), center({ pivot: 'below' })]
    if (lod.ratio < 1) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: lod.ratio, error: lod.error }))
    steps.push(
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^baseColorTexture$/, resize: [lod.base, lod.base], quality: 86, effort: 60 }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(?!baseColorTexture$).*$/, resize: [lod.detail, lod.detail], quality: 88, effort: 60 }),
      prune(),
      meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14 }),
    )
    await doc.transform(...steps)
    const target = path.join(OUT_DIR, lod.file)
    await io.write(target, doc)
    const bytes = await fs.readFile(target)
    const check = await io.readBinary(bytes) // proves it loads with MeshoptDecoder
    const tris = triangles(check)
    if (tris <= 0) throw new Error(`optimize produced empty mesh: ${lod.file}`)
    result[lod.key] = { path: rel(target), bytes: bytes.byteLength, triangles: tris, textures: { base: lod.base, detail: lod.detail } }
    if (lod.key === 'lod0') result.bbox = bboxOf(check)
  }
  return result
}

const isBroken = (opt) => {
  const s = opt.bbox.size
  const flatness = Math.min(...s) / Math.max(...s)
  if (opt.raw.triangles < 500) return `only ${opt.raw.triangles} triangles`
  if (!(flatness > 0.02)) return `bbox wildly flat ${s.join('×')}`
  return ''
}

// ---------- Tripo stages ----------
async function makeConcept(entry, dir, prompt) {
  return imageSlot(async () => {
    const full = `${prompt}, ${styleFor(entry)} --no ${entry.negative_prompt}`
    const taskId = await createTask('text-to-image', { model: IMAGE_MODEL, prompt: full, size: '2K', output_format: 'png', watermark: false })
    log(entry.id, `text-to-image ${taskId}`)
    const task = await waitTask(taskId, { timeoutMs: 10 * 60_000 })
    const url = outputUrl(task, ['generated_image_url', 'image_url', 'url'])
    if (!url) throw new Error(`text-to-image ${taskId}: no image url in output (${Object.keys(task.output ?? {}).join(',')})`)
    const file = await download(url, path.join(dir, 'concept'))
    log(entry.id, `concept ok (${task.credits_consumed ?? 0} cr) → ${rel(file.path)}`)
    return { ...slimTask(task), prompt: full, file: rel(file.path) }
  })
}

async function makeModel(entry, conceptTaskId, prompt) {
  return modelSlot(async () => {
    const common = { model: MODEL_VERSION, texture: true, pbr: true, texture_quality: 'detailed', face_limit: entry.face_limit, ...(TEXTURE_VERSION ? { texture_version: TEXTURE_VERSION } : {}) }
    const failures = []
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const taskId = await createTask('image-to-model', { input: conceptTaskId, ...common })
        log(entry.id, `image-to-model #${attempt} ${taskId}`)
        const task = await waitTask(taskId, { timeoutMs: 30 * 60_000 })
        return { ...slimTask(task), task, request: { endpoint: 'image-to-model', input: conceptTaskId, ...common }, failures }
      } catch (err) {
        failures.push(redact(err.message))
        log(entry.id, `image-to-model #${attempt} failed: ${err.message}`)
      }
    }
    const body = { prompt: `${prompt}, ${styleFor(entry)}`.slice(0, 1024), negative_prompt: entry.negative_prompt.slice(0, 255), ...common }
    const taskId = await createTask('text-to-model', body)
    log(entry.id, `fallback text-to-model ${taskId}`)
    const task = await waitTask(taskId, { timeoutMs: 30 * 60_000 })
    return { ...slimTask(task), task, request: { endpoint: 'text-to-model', ...body }, failures }
  })
}

async function processAsset(entry) {
  const dir = path.join(WORK_DIR, entry.id)
  await fs.mkdir(dir, { recursive: true })
  const rawPath = path.join(dir, 'raw.glb')
  let state = FORCE && !OPTIMIZE_ONLY ? {} : readState(dir)
  const spent = { concept: 0, model: 0 }
  const tries = []

  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = attempt === 1 ? entry.prompt : `${entry.prompt}, ${RETRY_HINT}`
    const reuse = attempt === 1 && !FORCE
    if (!(reuse && state.model && existsSync(rawPath))) {
      if (OPTIMIZE_ONLY) throw new Error('no raw.glb to optimize')
      if (!(reuse && state.concept?.task_id)) {
        state = { concept: await makeConcept(entry, dir, prompt) }
        writeState(dir, state)
      }
      const model = await makeModel(entry, state.concept.task_id, prompt)
      const modelUrl = outputUrl(model.task, ['pbr_model_url', 'model_url', 'base_model_url'])
      if (!modelUrl) throw new Error(`${model.task_id}: no model url in output (${Object.keys(model.task.output ?? {}).join(',')})`)
      await download(modelUrl, rawPath)
      const previewUrl = outputUrl(model.task, ['rendered_image_url'])
      const preview = previewUrl ? await download(previewUrl, path.join(dir, 'preview')).catch(() => null) : null
      const { task, ...modelRecord } = model
      state.model = { ...modelRecord, preview: preview ? rel(preview.path) : null }
      writeState(dir, state)
      log(entry.id, `${model.type} ok (${model.credits_consumed} cr) → ${rel(rawPath)}`)
    } else {
      log(entry.id, 'reusing existing raw.glb')
    }
    spent.concept += state.concept?.credits_consumed ?? 0
    spent.model += state.model?.credits_consumed ?? 0

    const opt = await optimizeSlot(() => optimize(entry, rawPath))
    const broken = isBroken(opt)
    tries.push({ concept: state.concept?.task_id, model: state.model?.task_id, broken: broken || null })
    if (broken && attempt === 1 && !OPTIMIZE_ONLY) {
      log(entry.id, `looks broken (${broken}) → retrying once with adjusted prompt`)
      state = {}
      continue
    }
    const prev = lock.assets[entry.id]
    const sizeY = opt.bbox.size[1]
    lock.assets[entry.id] = {
      id: entry.id,
      name_zh: entry.name_zh,
      status: broken ? 'suspect' : 'ok',
      ...(broken ? { note: broken } : {}),
      heightM: entry.heightM,
      scaleToHeight: sizeY > 0 ? round(entry.heightM / sizeY) : null,
      ...(entry.widthM ? { widthM: entry.widthM, scaleToWidth: round(entry.widthM / Math.max(opt.bbox.size[0], opt.bbox.size[2])) } : {}),
      instanced: entry.instanced,
      tasks: {
        concept: state.concept?.task_id ?? null,
        model: state.model?.task_id ?? null,
        modelType: state.model?.type ?? null,
        imageToModelFailures: state.model?.failures ?? [],
        attempts: OPTIMIZE_ONLY && prev ? prev.tasks?.attempts : tries,
      },
      modelVersion: MODEL_VERSION,
      textureVersion: TEXTURE_VERSION || 'default',
      imageModel: IMAGE_MODEL,
      credits: OPTIMIZE_ONLY && prev ? prev.credits : { concept: spent.concept, model: spent.model, total: spent.concept + spent.model },
      raw: opt.raw,
      lod0: opt.lod0,
      lod1: opt.lod1 ?? null,
      bbox: opt.bbox,
      preview: state.model?.preview ?? null,
      concept: state.concept?.file ?? null,
      generatedAt: OPTIMIZE_ONLY && prev ? prev.generatedAt : new Date().toISOString(),
      optimizedAt: new Date().toISOString(),
      // earlier generations replaced by --force (kept so credits/task ids stay auditable)
      history: [...(prev?.history ?? []), ...(prev && !OPTIMIZE_ONLY ? [{ tasks: prev.tasks, credits: prev.credits, raw: prev.raw, generatedAt: prev.generatedAt }] : [])],
    }
    delete lock.failures[entry.id]
    saveLock()
    log(entry.id, `DONE ${broken ? '(suspect) ' : ''}tris ${opt.raw.triangles}→${opt.lod0.triangles}${opt.lod1 ? `/${opt.lod1.triangles}` : ''}, ${(opt.lod0.bytes / 1024).toFixed(0)} KB, bbox ${opt.bbox.size.join('×')}, credits ${spent.concept + spent.model}`)
    return
  }
}

// ---------- main ----------
const entries = manifest.assets.filter((e) => (!only.length || only.includes(e.id)) && (FORCE || OPTIMIZE_ONLY || lock.assets[e.id]?.status !== 'ok'))
const unknown = only.filter((id) => !manifest.assets.some((e) => e.id === id))
if (unknown.length) throw new Error(`unknown ids: ${unknown.join(', ')}`)
if (!entries.length) {
  console.log('Nothing to do (all selected assets are in manifest.lock.json; use --force to regenerate).')
  process.exit(0)
}
const before = await balance()
const run = { startedAt: new Date().toISOString(), ids: entries.map((e) => e.id), force: FORCE, optimizeOnly: OPTIMIZE_ONLY, balanceBefore: before.balance }
lock.runs.push(run)
saveLock()
log('run', `${entries.length} asset(s): ${run.ids.join(', ')} | balance ${before.balance} (frozen ${before.frozen})`)

await Promise.all(entries.map((entry) => processAsset(entry).catch((err) => {
  lock.failures[entry.id] = { id: entry.id, error: redact(err.message), at: new Date().toISOString() }
  saveLock()
  log(entry.id, `FAILED: ${err.message}`)
})))

const after = await balance()
Object.assign(run, { finishedAt: new Date().toISOString(), balanceAfter: after.balance, spent: Math.round((before.balance - after.balance) * 100) / 100, failed: run.ids.filter((id) => lock.failures[id]) })
saveLock()
log('run', `finished | balance ${after.balance} (frozen ${after.frozen}) | spent ${run.spent} | failed: ${run.failed.join(', ') || 'none'}`)
