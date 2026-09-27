import assert from 'node:assert/strict'
import { openWorld } from './lib/world-session.mjs'

const { browser, page, errors } = await openWorld('?quality=low')
try {
  const result = await page.evaluate(async () => {
    const { Vector3 } = await import('/node_modules/.vite/deps/three.js')
    const { createPlayerRuntime, stepPlayer } = await import('/src/world/player/playerMotion.ts')
    const { registerWalkables } = await import('/src/world/surfaces.ts')
    const release = registerWalkables([{ kind: 'disc', x: 1000, z: 1000, y: 500, radius: 5 }])
    const checks = []
    try {
      for (const fps of [60, 144]) for (const edge of [0.1, 0.3, 0.5]) {
        const r = createPlayerRuntime(); r.ready = true
        r.position.set(1000, 500, 995 + edge); r.velocity.z = -10; r.jumpBuffer = 0.15
        let lifted = false
        for (let n = 0; n < Math.ceil(fps * 0.15); n++) {
          stepPlayer(r, new Vector3(0, 0, -1), true, 1 / fps)
          lifted ||= r.velocity.y > 0
        }
        checks.push([`edge ${fps}/${edge}`, lifted])
      }
      const r = createPlayerRuntime(); r.position.set(1000, 500, 1000); r.jumpBuffer = 0.15
      stepPlayer(r, new Vector3(), false, 1 / 144)
      r.jumpBuffer = 0.15 // A second press delivered by an alternative input source.
      for (let n = 0; n < 16; n++) stepPlayer(r, new Vector3(), false, 1 / 144)
      checks.push(['double press consumed', r.velocity.y > 0 && r.jumpBuffer === 0])
    } finally { release() }
    return checks
  })
  for (const [name, ok] of result) { assert.ok(ok, name); console.log('PASS', name) }
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW' }))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: '∑', code: 'KeyW' }))
  })
  assert.ok(!(await page.evaluate(() => window.__playerSnapshot().keys)).includes('KeyW'))
  for (const event of ['meta', 'blur']) {
    await page.evaluate((event) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW' }))
      window.dispatchEvent(event === 'meta' ? new KeyboardEvent('keydown', { code: 'MetaLeft', metaKey: true }) : new Event('blur'))
    }, event)
    assert.equal((await page.evaluate(() => window.__playerSnapshot().keys)).length, 0)
  }
  for (const activation of ['Enter', 'Space']) {
    const entry = await browser.newPage()
    await entry.goto(new URL('?quality=low', process.env.BASE_URL || 'http://127.0.0.1:5173/').href)
    await entry.waitForFunction(() => document.querySelector('.enter-button')?.disabled === false, null, { timeout: 180000 })
    await entry.keyboard.press('Shift+Tab'); await entry.keyboard.press('Tab')
    assert.equal(await entry.evaluate(() => document.activeElement?.className), 'enter-button')
    await entry.keyboard.press(activation)
    await entry.waitForFunction(() => window.__ui.state().started && window.__ui.state().locked)
    await entry.close()
  }
  assert.deepEqual(errors, [])
  console.log('PASS physical keys, native keyboard entry and pointer lock')
} finally { await browser.close() }
