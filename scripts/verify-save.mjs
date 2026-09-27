import assert from 'node:assert/strict'
import { installLiveImports, openWorld } from './lib/world-session.mjs'
const { browser, page, errors } = await openWorld('?quality=low')
try {
  const results = await page.evaluate(async () => {
    const save = await window.__liveImport('/src/ui/save.ts')
    const { default: legacy } = await window.__liveImport('/src/ui/legacyOrbs.json')
    const { ORBS } = await window.__liveImport('/src/world/interact/orbs.ts')
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
    save.applySave({ ...migrated, position: { x: 0, y: 550, z: 150, yaw: 0 } })
    checks.push(['unsafe legacy position falls back to spawn', save.safePosition().y === 0])
    const { getPlayerRuntime } = await window.__liveImport('/src/world/player/playerHandle.ts')
    const runtime = getPlayerRuntime(), previousPhase = runtime.phase
    runtime.phase = 'FLIGHT'; save.flushSave(); runtime.phase = previousPhase
    checks.push(['unsafe legacy position never written to v2', JSON.parse(localStorage.getItem(save.SAVE_KEY)).position.y === 0])
    localStorage.setItem('yunque.save.v2', JSON.stringify({ version: 99 }))
    save.loadSave(); save.flushSave()
    checks.push(['future version protected', JSON.parse(localStorage.getItem('yunque.save.v2')).version === 99])
    return checks
  })
  for (const [name, ok] of results) { assert.ok(ok, name); console.log('PASS', name) }
  for (const corrupt of [false, true]) {
    // A fresh document also resets the once-per-session storage guard.
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!window.__ui)
    await installLiveImports(page)
    const failure = await page.evaluate(async (corrupt) => {
      const save = await window.__liveImport('/src/ui/save.ts')
      const { useWorldStore } = await window.__liveImport('/src/world/store.ts')
      useWorldStore.getState().setStarted(true)
      if (corrupt) localStorage.setItem(save.SAVE_KEY, '{retain-me')
      const native = Storage.prototype.setItem, warn = console.warn
      let attempts = 0, warnings = 0
      Storage.prototype.setItem = () => { attempts++; throw new DOMException('quota test', 'QuotaExceededError') }
      console.warn = (...args) => { if (String(args[0]).startsWith('[save]')) warnings++; else warn(...args) }
      try {
        if (corrupt) save.loadSave()
        for (let n = 0; n < 5; n++) save.flushSave()
        return { attempts, warnings, retained: localStorage.getItem(save.SAVE_KEY) }
      } finally { Storage.prototype.setItem = native; console.warn = warn }
    }, corrupt)
    assert.equal(failure.attempts, 1); assert.equal(failure.warnings, 1)
    if (corrupt) assert.equal(failure.retained, '{retain-me')
    console.log('PASS storage failure stops retries; backup failure retains raw data', corrupt)
  }
  assert.deepEqual(errors, [])
} finally { await browser.close() }
