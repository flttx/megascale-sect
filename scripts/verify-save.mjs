import assert from 'node:assert/strict'
import { openWorld } from './lib/world-session.mjs'
const { browser, page, errors } = await openWorld('?quality=low')
try {
  const results = await page.evaluate(async () => {
    const save = await import('/src/ui/save.ts')
    const { default: legacy } = await import('/src/ui/legacyOrbs.json')
    const { ORBS } = await import('/src/world/interact/orbs.ts')
    const checks = []
    localStorage.clear()
    const old = { version: 1, orbs: ['orb_00', 'orb_30', 'orb_59'], position: { x: 0, y: 0, z: 150, yaw: 0 } }
    localStorage.setItem('yunque.save.v1', JSON.stringify(old))
    const migrated = save.loadSave()
    checks.push(['migrated version', migrated.version === 2])
    for (const id of old.orbs) {
      const pair = legacy.find((p) => p.oldId === id), orb = ORBS.find((o) => o.id === pair.id)
      checks.push([id, migrated.orbs.includes(pair.id) && JSON.stringify(pair.position) === JSON.stringify(orb.position)])
    }
    checks.push(['idempotent migration', JSON.stringify(save.migrate(migrated)) === JSON.stringify(migrated)])
    save.applySave(migrated); save.flushSave()
    checks.push(['v1 retained', JSON.parse(localStorage.getItem('yunque.save.v1')).version === 1])
    checks.push(['v2 persisted', JSON.parse(localStorage.getItem('yunque.save.v2')).orbs.length === 3])
    localStorage.setItem('yunque.save.v2', '{broken-json')
    checks.push(['corrupt rejected', save.loadSave() === null])
    checks.push(['corrupt backed up', localStorage.getItem('yunque.save.corrupt') === '{broken-json'])
    localStorage.setItem('yunque.save.v2', JSON.stringify({ version: 99 }))
    save.loadSave(); save.flushSave()
    checks.push(['future version protected', JSON.parse(localStorage.getItem('yunque.save.v2')).version === 99])
    return checks
  })
  for (const [name, ok] of results) { assert.ok(ok, name); console.log('PASS', name) }
  assert.deepEqual(errors, [])
} finally { await browser.close() }
