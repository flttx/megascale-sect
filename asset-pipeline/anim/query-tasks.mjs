import { getTask, redact } from '../../scripts/tripo/client.mjs'
const ids = process.argv.slice(2)
for (const id of ids) {
  try {
    const t = await getTask(id)
    const s = JSON.stringify(t, null, 1).replace(/https:\/\/[^"]+/g, 'URL')
    console.log(redact(s))
  } catch (e) { console.log(id, 'ERR', redact(e.message)) }
}
