// probe which prompt fragments pass the text-to-image content policy (creates tasks only when accepted)
import { createTask, redact } from '../../scripts/tripo/client.mjs'
const prompts = JSON.parse(process.argv[2])
for (const p of prompts) {
  try {
    const id = await createTask('text-to-image', { model: 'seedream_v5', prompt: p, size: '2K', output_format: 'png', watermark: false })
    console.log('OK  ', id, '|', p.slice(0, 90))
  } catch (e) { console.log('FAIL', redact(e.message).slice(0, 60), '|', p.slice(0, 90)) }
}
