// One-time v1 migration fixture. Refuses to regenerate after semantic IDs are installed.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld } from './lib/world-session.mjs'
const { browser, page } = await openWorld('?quality=low')
try {
  const orbs = await page.evaluate(async () => (await import('/src/world/interact/orbs.ts')).ORBS)
  assert.equal(orbs.length, 60)
  const counts = new Map()
  const mapping = orbs.map((orb, i) => {
    assert.equal(orb.id, `orb_${String(i).padStart(2, '0')}`)
    const base = orb.cluster === orb.group ? orb.group : `${orb.group}_${orb.cluster}`
    const n = counts.get(base) || 0; counts.set(base, n + 1)
    return { oldId: orb.id, id: `orb_${base}_${n}`, position: orb.position }
  })
  await fs.writeFile('src/ui/legacyOrbs.json', JSON.stringify(mapping, null, 2) + '\n')
  console.log('Frozen', mapping.length, 'legacy orbs')
} finally { await browser.close() }
