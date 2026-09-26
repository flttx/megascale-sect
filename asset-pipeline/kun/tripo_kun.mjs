// 鲲 (Kun) hero asset — Tripo stages. The API key is never printed (client.mjs loads it and redact() scrubs logs).
// Usage:
//   node asset-pipeline/kun/tripo_kun.mjs concept <tag> <variant>   text-to-image → concept_<tag>.*
//   node asset-pipeline/kun/tripo_kun.mjs model <tag> [faceLimit]   image-to-model from concept_<tag> → raw_<tag>.glb
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTask, waitTask, download, outputUrl, redact } from '../../scripts/tripo/client.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const STATE = path.join(DIR, 'tasks.json')
const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { concepts: {}, models: {} })
const state = load()
// re-read before writing so parallel runs don't clobber each other's entries
const record = (kind, key, value) => {
  const fresh = load()
  fresh[kind][key] = value
  state[kind][key] = value
  writeFileSync(STATE, `${JSON.stringify(fresh, null, 2)}\n`)
}
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${redact(m)}`)

const IMAGE_MODEL = 'seedream_v5'
const MODEL_VERSION = 'v3.1-20260211'
const TEXTURE_VERSION = 'v3.5-20260815'

const BODY = 'colossal ancient Kun from Chinese mythology, a giant sky whale, a single whale, the entire whale visible from head to tail, realistic massive whale shape like a humpback whale with a long tapering tail and broad horizontal tail flukes, very long elegant wing-like pectoral fins spread wide outward to the sides like wings, heavy weathered deeply wrinkled whale hide, deep slate blue-grey back fading to a pale jade and ivory underside with long throat grooves, clusters of barnacles and jade-green and grey stone encrustations on the head, back and fins, faint engraved auspicious xiangyun cloud swirl patterns with subtle gold inlay, majestic, ancient, realistic concept art sculpture'
const STYLE = 'isolated on a plain light grey studio background, no water, no clouds, no ground, no text, soft even studio lighting, sharp silhouette, high detail'
const NEG = 'cartoon, cute, toy, anime, several whales, water, ocean, splash, clouds, sky, ground, people, text, watermark, cropped, blurry, low quality'

const VARIANTS = {
  // 3/4 view from above-front-side: both fins visible, flukes visible
  a: `${BODY}, three-quarter view from slightly above and to the side, head pointing left, both pectoral fins clearly visible and spread`,
  // same with the ruined pavilion + pines on its back
  b: `${BODY}, a small overgrown ruined Chinese pavilion with a few gnarled pine trees growing on the middle of its back, three-quarter view from slightly above and to the side, head pointing left, both pectoral fins clearly visible and spread`,
  // pure side view
  c: `${BODY}, side view profile, head pointing left, pectoral fins spread outward and slightly down, tail flukes horizontal`,
  // 3/4 top-down, gliding pose
  d: `${BODY}, gliding pose with fins spread flat like wings, three-quarter top view from above and slightly in front, head pointing to the lower left, symmetric, straight body`,
  // d pose + small ruined pavilion / pine grove on the back
  e: `${BODY}, a small overgrown ruined Chinese pavilion with a few gnarled pine trees with dense needle foliage growing on the middle of its back, gliding pose with fins spread flat like wings, three-quarter top view from above and slightly in front, head pointing to the lower left, symmetric, straight body`,
}

const [cmd, tag, arg] = process.argv.slice(2)

async function concept() {
  const prompt = VARIANTS[arg ?? tag]
  if (!prompt) throw new Error(`unknown variant ${arg ?? tag}`)
  const full = `${prompt}, ${STYLE} --no ${NEG}`
  const taskId = await createTask('text-to-image', { model: IMAGE_MODEL, prompt: full, size: '2K', output_format: 'png', watermark: false })
  log(`concept ${tag} text-to-image ${taskId}`)
  const task = await waitTask(taskId, { timeoutMs: 10 * 60_000 })
  const url = outputUrl(task, ['generated_image_url', 'image_url', 'url'])
  if (!url) throw new Error(`no image url (${Object.keys(task.output ?? {}).join(',')})`)
  const file = await download(url, path.join(DIR, `concept_${tag}`))
  record('concepts', tag, { task_id: taskId, variant: arg ?? tag, prompt: full, file: path.basename(file.path), credits: task.credits_consumed ?? 0 })
  log(`concept ${tag} ok → ${path.basename(file.path)}`)
}

async function model() {
  const c = state.concepts[tag]
  if (!c) throw new Error(`no concept ${tag}`)
  const faceLimit = Number(arg ?? 80000)
  const body = { input: c.task_id, model: MODEL_VERSION, texture: true, pbr: true, texture_quality: 'detailed', face_limit: faceLimit, texture_version: TEXTURE_VERSION }
  const taskId = await createTask('image-to-model', body)
  log(`model ${tag} image-to-model ${taskId}`)
  const task = await waitTask(taskId, { timeoutMs: 40 * 60_000 })
  const url = outputUrl(task, ['pbr_model_url', 'model_url', 'base_model_url'])
  if (!url) throw new Error(`no model url (${Object.keys(task.output ?? {}).join(',')})`)
  const raw = await download(url, path.join(DIR, `raw_${tag}.glb`))
  const pv = outputUrl(task, ['rendered_image_url'])
  const preview = pv ? await download(pv, path.join(DIR, `tripo_preview_${tag}`)).catch(() => null) : null
  record('models', tag, { task_id: taskId, request: body, file: path.basename(raw.path), bytes: raw.bytes, preview: preview ? path.basename(preview.path) : null, credits: task.credits_consumed ?? 0 })
  log(`model ${tag} ok → ${path.basename(raw.path)} (${(raw.bytes / 1e6).toFixed(1)} MB)`)
}

try {
  if (cmd === 'concept') await concept()
  else if (cmd === 'model') await model()
  else throw new Error('usage: concept <tag> [variant] | model <tag> [faceLimit]')
} catch (err) {
  console.error(redact(err?.message ?? err))
  process.exit(1)
}
