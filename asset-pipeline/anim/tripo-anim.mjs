// Tripo animation pipeline: v1 humanoid rig (spec=tripo, the only spec the retargeter accepts)
// + preset retargets, one clip per task. Records everything in tripo/lock.json. Key never printed.
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createTask, waitTask, download, outputUrl, redact } from '../../scripts/tripo/client.mjs'

const OUT = path.resolve('asset-pipeline/anim/tripo')
const LOCK = path.join(OUT, 'lock.json')
await fs.mkdir(OUT, { recursive: true })
const lock = existsSync(LOCK) ? JSON.parse(await fs.readFile(LOCK, 'utf8')) : {}
const save = () => fs.writeFile(LOCK, JSON.stringify(lock, null, 2))
const say = (...a) => console.log(redact(a.join(' ')))

const CHARS = {
  male: { source: '87a0bb2a-7036-4b35-9aee-0f38ba5c8daa', rig: '533966ff-b7cc-48a6-8c4a-65e806c00f50' },
  female: { source: 'f662dc18-023f-489a-8790-c71ac906ebb8' },
}
const [charArg, presetsArg] = process.argv.slice(2)
const chars = charArg === 'all' ? Object.keys(CHARS) : [charArg]
const presets = presetsArg.split(',')

async function ensureRig(c) {
  lock[c] ??= {}
  if (lock[c].rig) return lock[c].rig
  let id = CHARS[c].rig
  if (!id) {
    id = await createTask('/animations/rig', { input: CHARS[c].source, model: 'v1.0-20240301', rig_type: 'biped', spec: 'tripo', out_format: 'glb' })
    say(c, 'rig created', id)
  }
  const t = await waitTask(id)
  const url = outputUrl(t, ['model_url'])
  const dl = await download(url, path.join(OUT, c, 'rig_tripo.glb'))
  lock[c].rig = id; lock[c].rigCredits = t.credits_consumed; await save()
  say(c, 'rig ok', id, dl.bytes)
  return id
}

async function retarget(c, rigId, preset) {
  const name = preset.split(':').pop()
  lock[c].clips ??= {}
  const prev = lock[c].clips[name]
  if (prev?.status === 'success' && existsSync(path.join(OUT, c, `${name}.glb`))) { say(c, name, 'cached'); return }
  let id
  try {
    id = await createTask('/animations/retarget', { input: rigId, animation: preset, out_format: 'glb', bake_animation: true, export_with_geometry: false, animate_in_place: false })
  } catch (e) { lock[c].clips[name] = { preset, status: 'create-failed', error: redact(e.message) }; await save(); say(c, name, 'create failed', e.message); return }
  try {
    const t = await waitTask(id)
    const dl = await download(outputUrl(t, ['model_url']), path.join(OUT, c, `${name}.glb`))
    lock[c].clips[name] = { preset, task: id, status: 'success', credits: t.credits_consumed, bytes: dl.bytes }
    say(c, name, 'ok', id, dl.bytes)
  } catch (e) {
    lock[c].clips[name] = { preset, task: id, status: 'failed', error: redact(e.body?.error_message ?? e.message) }
    say(c, name, 'failed', id, e.body?.error_message ?? e.message)
  }
  await save()
}

await Promise.all(chars.map(async (c) => {
  const rigId = await ensureRig(c)
  await Promise.all(presets.map((p) => retarget(c, rigId, p)))
}))
