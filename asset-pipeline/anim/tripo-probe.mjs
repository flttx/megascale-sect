// Probe Tripo retarget compatibility. Never prints the key (client redacts).
import fs from 'node:fs/promises'
import path from 'node:path'
import { createTask, waitTask, redact } from '../../scripts/tripo/client.mjs'
const OUT = path.resolve('asset-pipeline/anim/tripo')
await fs.mkdir(OUT, { recursive: true })
const log = async (obj) => { const s = redact(JSON.stringify(obj).replace(/https:\/\/[^"]+/g, 'URL')); console.log(s); await fs.appendFile(path.join(OUT, 'probe.log'), s + '\n') }
const [mode, ...rest] = process.argv.slice(2)
async function run(endpoint, body, label) {
  let id
  try { id = await createTask(endpoint, body) } catch (e) { await log({ label, stage: 'create', error: redact(e.message) }); return null }
  await log({ label, stage: 'created', id, body })
  try { const t = await waitTask(id, { timeoutMs: 15 * 60_000 }); await log({ label, stage: 'done', id, status: t.status, output: t.output, credits: t.credits_consumed }); return t }
  catch (e) { await log({ label, stage: 'failed', id, error: redact(e.message) }); return null }
}
if (mode === 'rig') {
  const [input, model, spec, label] = rest
  const body = { input, rig_type: 'biped', spec, out_format: 'glb' }
  if (model !== '-') body.model = model
  await run('/animations/rig', body, label)
} else if (mode === 'retarget') {
  const [input, anims, label, inPlace] = rest
  const list = anims.split(',')
  const body = { input, out_format: 'glb', export_with_geometry: true, animate_in_place: inPlace === '1' }
  if (list.length === 1) body.animation = list[0]; else body.animations = list
  await run('/animations/retarget', body, label)
}
