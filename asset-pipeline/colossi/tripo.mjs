// Colossi Tripo driver. The API key is loaded by scripts/tripo/client.mjs and never printed.
// Usage:
//   node asset-pipeline/colossi/tripo.mjs concepts <asset> <variant> <count> [model]   text-to-image
//   node asset-pipeline/colossi/tripo.mjs edit <asset> <variant> <count> <refTaskId>    image-to-image restyle
//   node asset-pipeline/colossi/tripo.mjs model <asset> <conceptKey> [tag]              image-to-model
// State: asset-pipeline/colossi/<asset>/state.json (concept task ids, model task ids, files).
import fs from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTask, waitTask, download, outputUrl, redact } from '../../scripts/tripo/client.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MODEL_VERSION = 'v3.1-20260211'
const TEXTURE_VERSION = 'v3.5-20260815'

const STATUE_STYLE = 'monumental ancient stone sculpture, carved from pale grey granite and limestone, heavily weathered, moss and lichen streaks, fine cracks and chipped edges, faint remnants of gold leaf on the crown and trim, Chinese xianxia fantasy, single isolated object, centered, the entire statue visible from the top of the head to the bottom of the plinth, plain flat light grey studio background, no ground plane, no shadow on the background, soft even diffuse lighting, no harsh highlights, strong three-dimensional volume, high detail, photorealistic 3D render'
const STATUE_NEG = 'cropped, cut off, multiple figures, second statue, landscape, mountains, sky, clouds, ground, floor, pedestal cut off, text, watermark, signature, blurry, low quality, painting, flat 2D, colourful paint, modern clothing'
const PLINTH = 'standing on a rough rocky natural stone plinth, a craggy boulder base slightly wider than the feet'

const PROMPTS = {
  guardian_a: {
    front: `Colossal statue of a Chinese celestial guardian general (天将), standing upright, full body, ornate layered lamellar armour with shoulder guards shaped like beast heads over long flowing robes that fall to the feet, tall helmet-crown, both hands stacked resting on the pommel of a great straight sword planted point-down vertically on the plinth directly in front of him, the sword blade between his feet, head slightly bowed, serene calm face with eyes lowered, ${PLINTH}, front view, symmetrical, ${STATUE_STYLE}`,
    q34: `Colossal statue of a Chinese celestial guardian general (天将), standing upright, full body, ornate layered lamellar armour with shoulder guards over long flowing robes that fall to the feet, tall helmet-crown, both hands stacked resting on the pommel of a great straight sword planted point-down vertically on the plinth directly in front of him, head slightly bowed, serene calm face with eyes lowered, ${PLINTH}, three-quarter front view, ${STATUE_STYLE}`,
  },
  guardian_b: {
    front: `Colossal statue of a Chinese female immortal goddess (仙女), standing upright, full body, graceful layered long flowing robes with wide sleeves falling to the feet, long ribbon sashes (披帛) draped over both forearms and hanging down close to the body in solid carved folds until they touch the plinth, elegant high hair bun with a small crown, her left hand holds a lotus lamp at waist height, her right hand raised before her chest in a mudra gesture, serene gentle face with eyes lowered, ${PLINTH}, front view, ${STATUE_STYLE}`,
    q34: `Colossal statue of a Chinese female immortal goddess (仙女), standing upright, full body, graceful layered long flowing robes with wide sleeves falling to the feet, long ribbon sashes (披帛) draped over both forearms and hanging down close to the body in solid carved folds until they touch the plinth, elegant high hair bun with a small crown, her left hand holds a lotus lamp at waist height, her right hand raised before her chest in a mudra gesture, serene gentle face with eyes lowered, ${PLINTH}, three-quarter front view, ${STATUE_STYLE}`,
  },
  giant_sword: {
    muted: 'An immense ancient Chinese straight double-edged jian sword, shown vertically with the blade tip pointing straight down, the whole sword visible from the ring pommel at the top to the sharp blade tip at the bottom, long straight thin flat blade of old grey steel with a dull bronze tint, light rust and faint verdigris stains, engraved seal-script runes running along the central fuller, compact crossguard of dark muted celadon antique jade with worn gold inlay, straight hilt tightly wrapped in dark brown cord, a round bronze ring pommel at the top with a long faded dusty red silk tassel hanging straight down beside the hilt, front view with the flat of the blade facing the viewer, museum artifact photograph, single isolated object, centered, no hand, no person, no ground, no stone, plain flat light grey studio background, soft even diffuse lighting, matte, high detail',
    front: 'An immense ancient Chinese straight double-edged jian sword, shown vertically with the blade tip pointing straight down, the whole sword visible from the ring pommel at the top to the sharp blade tip at the bottom, long straight blade of slightly corroded dark bronze-steel with green verdigris patina and pitting, engraved seal-script runes running along the central fuller, ornate crossguard of carved green jade inlaid with gold, straight hilt tightly wrapped in dark cord, a round ring pommel at the top with a long faded red silk tassel hanging down beside the hilt, front view with the flat of the blade facing the viewer, single isolated object, centered, no hand, no person, no ground, no stone, plain flat light grey studio background, soft even diffuse lighting, strong three-dimensional volume, high detail, photorealistic 3D render',
  },
}
const NEG = {
  guardian_a: STATUE_NEG,
  guardian_b: STATUE_NEG,
  giant_sword: 'hand, person, ground, rock, stone, embedded, scabbard, curved blade, katana, broken blade, multiple swords, cropped, cut off, text, watermark, blurry, low quality, glowing, fire',
}
const SIZE = { guardian_a: '1728x3072', guardian_b: '1728x3072', giant_sword: '1152x3456' }
const CHAT_SIZE = { guardian_a: '1024x1536', guardian_b: '1024x1536', giant_sword: '1024x1536' }
const FACE_LIMIT = { guardian_a: 58000, guardian_b: 58000, giant_sword: 19000 }

const [cmd, asset, ...rest] = process.argv.slice(2)
if (!PROMPTS[asset]) throw new Error(`unknown asset ${asset}`)
const dir = path.join(HERE, asset)
await fs.mkdir(path.join(dir, 'concepts'), { recursive: true })
await fs.mkdir(path.join(dir, 'raw'), { recursive: true })
const stateFile = path.join(dir, 'state.json')
const load = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { concepts: {}, models: {} })
const save = (fn) => { const s = load(); fn(s); writeFileSync(stateFile, `${JSON.stringify(s, null, 2)}\n`) }
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${asset} ${redact(msg)}`)

async function concept(variant, idx, model, refTask) {
  const key = `${variant}_${model}_${Date.now().toString(36)}_${idx}`
  const prompt = `${PROMPTS[asset][variant]} --no ${NEG[asset]}`
  let body
  if (refTask) {
    body = { model: 'seedream_v5', input: refTask, prompt: `Create a companion statue in exactly the same stone material, weathering, lighting, background, camera and plinth style as the reference image: ${PROMPTS[asset][variant]}`, size: SIZE[asset], output_format: 'png' }
  } else if (model.startsWith('chat_image')) {
    body = { model, prompt, size: CHAT_SIZE[asset], quality: 'high', output_format: 'png' }
  } else {
    body = { model, prompt, size: SIZE[asset], output_format: 'png', watermark: false }
  }
  const taskId = await createTask(refTask ? 'image-to-image' : 'text-to-image', body)
  log(`${key} ${refTask ? 'image-to-image' : 'text-to-image'} ${taskId}`)
  const task = await waitTask(taskId, { timeoutMs: 15 * 60_000 })
  const url = outputUrl(task, ['generated_image_url', 'image_url', 'url'])
  if (!url) throw new Error(`no image url (${Object.keys(task.output ?? {}).join(',')})`)
  const file = await download(url, path.join(dir, 'concepts', key))
  save((s) => { s.concepts[key] = { task_id: taskId, variant, model, ref: refTask ?? null, file: path.basename(file.path), at: new Date().toISOString() } })
  log(`${key} -> ${path.basename(file.path)}`)
}

async function model(conceptKey, tag = 'm') {
  const c = load().concepts[conceptKey]
  if (!c) throw new Error(`unknown concept ${conceptKey}`)
  const body = {
    input: c.task_id, model: MODEL_VERSION, texture: true, pbr: true,
    texture_quality: 'detailed', geometry_quality: 'detailed', texture_version: TEXTURE_VERSION, delight: true,
    face_limit: FACE_LIMIT[asset], texture_alignment: 'original_image',
  }
  const key = `${conceptKey}__${tag}`
  const taskId = await createTask('image-to-model', body)
  log(`${key} image-to-model ${taskId}`)
  const task = await waitTask(taskId, { timeoutMs: 40 * 60_000, interval: 5000 })
  const url = outputUrl(task, ['pbr_model_url', 'model_url', 'base_model_url'])
  if (!url) throw new Error(`no model url (${Object.keys(task.output ?? {}).join(',')})`)
  const raw = await download(url, path.join(dir, 'raw', `${key}.glb`))
  const prevUrl = outputUrl(task, ['rendered_image_url'])
  const prev = prevUrl ? await download(prevUrl, path.join(dir, 'raw', `${key}_preview`)).catch(() => null) : null
  save((s) => { s.models[key] = { task_id: taskId, concept: conceptKey, request: { ...body }, file: path.basename(raw.path), bytes: raw.bytes, preview: prev ? path.basename(prev.path) : null, credits: task.credits_consumed ?? null, at: new Date().toISOString() } })
  log(`${key} -> ${path.basename(raw.path)} (${(raw.bytes / 1e6).toFixed(1)} MB)`)
}

try {
  if (cmd === 'concepts') {
    const [variant, count = '2', m = 'seedream_v5'] = rest
    for (let i = 0; i < Number(count); i++) await concept(variant, i, m).catch((e) => log(`concept ${i} FAILED ${e.message}`)) // image gen allows ~1 concurrent task
  } else if (cmd === 'edit') {
    const [variant, count = '2', ref] = rest
    for (let i = 0; i < Number(count); i++) await concept(variant, i, 'i2i', ref).catch((e) => log(`edit ${i} FAILED ${e.message}`))
  } else if (cmd === 'model') {
    await model(rest[0], rest[1])
  } else throw new Error(`unknown cmd ${cmd}`)
} catch (e) {
  log(`FAILED ${e.message}`)
  process.exitCode = 1
}
