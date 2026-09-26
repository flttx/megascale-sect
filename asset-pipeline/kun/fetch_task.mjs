// download the image/model output of an existing task: node fetch_task.mjs <taskId> <destBase>
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getTask, download, outputUrl, redact } from '../../scripts/tripo/client.mjs'
const DIR = path.dirname(fileURLToPath(import.meta.url))
const [id, dest] = process.argv.slice(2)
try {
  const t = await getTask(id)
  console.log(t.status, Object.keys(t.output ?? {}).join(','))
  const url = outputUrl(t, ['generated_image_url', 'image_url', 'pbr_model_url', 'model_url', 'url'])
  if (url) console.log((await download(url, path.join(DIR, dest))).path)
} catch (e) { console.error(redact(e.message)); process.exit(1) }
