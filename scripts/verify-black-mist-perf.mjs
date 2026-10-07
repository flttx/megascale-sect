import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { openWorld, review, telemetry, VIEWS } from './lib/world-session.mjs'
import { creatureView } from './lib/eldritch-views.mjs'

// Black Mist's front, transformation, every creature family/variant and living tissue on all tiers.
// Every real rendered frame sample must preserve the existing 400-draw scene budget.
const MAX_DRAW_CALLS = 400
const MIN_FPS = Number(process.env.MIN_FPS || 0)
const QUALITIES = (process.env.QUALITIES || 'high,mid,low').split(',')
const viewport = { width: Number(process.env.WIDTH || 1600), height: Number(process.env.HEIGHT || 900) }
assert.ok(
  Object.values(viewport).every((value) => Number.isInteger(value) && value >= 320),
  'WIDTH/HEIGHT must be integers >= 320',
)
assert.ok(
  QUALITIES.every((quality) => ['high', 'mid', 'low'].includes(quality)),
  'QUALITIES must contain known quality tiers',
)
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const runs = [],
  errors = []
async function measure(page) {
  const samples = []
  for (let i = 0; i < 5; i++) {
    samples.push(await telemetry(page))
    await page.waitForTimeout(300)
  }
  return {
    fps: Math.round(median(samples.map((sample) => sample.fps))),
    drawCalls: Math.max(...samples.map((sample) => sample.drawCalls)),
    triangles: Math.max(...samples.map((sample) => sample.triangles)),
  }
}
async function record(page, quality, view, elapsed) {
  const result = { quality, view, elapsed, ...(await measure(page)) }
  runs.push(result)
  console.log(
    `${quality.padEnd(4)} ${view.padEnd(18)} ${String(result.fps).padStart(4)} fps  ${String(result.drawCalls).padStart(3)} calls  ${(result.triangles / 1e6).toFixed(2)}M tris`,
  )
}
await fs.mkdir('artifacts/black-mist', { recursive: true })
try {
  for (const quality of QUALITIES) {
    const {
      browser,
      page,
      errors: pageErrors,
    } = await openWorld(`?quality=${quality}&hours=15&weather=clear`, viewport)
    try {
      await page.evaluate(() => {
        window.__blackMist.reset()
        window.__blackMist.hold(true)
      })
      await page.waitForFunction(() => window.__blackMist.snapshot().assets.ready, null, { timeout: 70000 })
      for (const elapsed of [8, 18, 28.2, 35.2, 38.2, 41, 45, 48, 53, 64]) {
        await page.evaluate((time) => window.__blackMist.seek(time), elapsed)
        await page.waitForTimeout(1300)
        await record(page, quality, `cinematic-${elapsed}`, elapsed)
      }
      await page.evaluate(() => {
        window.__blackMist.skip()
        window.__ui.setHudHidden(true)
      })
      for (const view of ['hero', 'overview', 'east', 'world']) {
        await review(page, VIEWS[view], 1900)
        await record(page, quality, `aftermath-${view}`, 68)
      }
      const ids = await page.evaluate(() => window.__blackMist.snapshot().creatures.map((actor) => actor.id))
      assert.equal(ids.length, 6, 'all six horror actors must contribute to the verified scene')
      for (const id of ids)
        for (const phase of ['patrol', 'roar']) {
          const time = await page.evaluate(
            async ({ id, phase }) => {
              const [{ HORROR_LAYOUT }, { sampleHorrorMotion }] = await Promise.all([
                window.__liveImport('/src/world/blackMist/horrorLayout.ts'),
                window.__liveImport('/src/world/blackMist/horrorMotion.ts'),
              ])
              const placement = HORROR_LAYOUT.find((item) => item.id === id)
              return phase === 'patrol'
                ? placement.patrol.period * 0.4
                : sampleHorrorMotion(placement, 0).roarStart + 1.3
            },
            { id, phase },
          )
          await page.evaluate((time) => {
            window.__blackMist.seekMotion(time)
            window.__blackMist.motionHold(true)
          }, time)
          await page.waitForTimeout(150)
          const snapshot = await page.evaluate(() => window.__blackMist.snapshot())
          const actor = snapshot.creatures.find((creature) => creature.id === id)
          assert.ok(actor?.visible, `${id} must be rendered for its performance view`)
          await review(page, creatureView(actor), 500)
          await page.evaluate(() => window.__blackMist.motionHold(false))
          await record(page, quality, `${id}-${phase}`, 68)
        }
      const livingSites = await page.evaluate(() => window.__blackMist.snapshot().tissue.sites)
      for (const surface of ['ground', 'building']) {
        const site = livingSites.find((entry) => entry.surface === surface)
        assert.ok(site?.visible, `${surface} tissue must be drawn in the altered world`)
        const [x, y, z] = site.root,
          [nx, ny, nz] = site.normal
        await review(
          page,
          [
            [x + nx * 9 + 3, y + ny * 9 + 4, z + nz * 9 + 8],
            [x, y + 1, z],
          ],
          900,
        )
        await record(page, quality, `living-${surface}`, 68)
      }
      const snapshot = await page.evaluate(() => window.__blackMist.snapshot())
      assert.equal(snapshot.corruption, 1, 'aftermath performance views must retain the full mutation')
    } finally {
      errors.push(...pageErrors.map((error) => `${quality}: ${error}`))
      await browser.close()
    }
  }
} finally {
  const breaches = runs.filter((run) => run.drawCalls > MAX_DRAW_CALLS || (MIN_FPS > 0 && run.fps < MIN_FPS))
  await fs.writeFile(
    'artifacts/black-mist/perf.json',
    JSON.stringify(
      { viewport, maxDrawCalls: MAX_DRAW_CALLS, minFps: MIN_FPS || null, runs, breaches, errors },
      null,
      2,
    ),
  )
}
const breaches = runs.filter((run) => run.drawCalls > MAX_DRAW_CALLS || (MIN_FPS > 0 && run.fps < MIN_FPS))
const worst = runs.reduce((a, b) => (b.drawCalls > a.drawCalls ? b : a))
console.log(`worst: ${worst.drawCalls} calls (${worst.quality}/${worst.view}); budget ${MAX_DRAW_CALLS}`)
if (breaches.length) console.log('BUDGET BREACH', JSON.stringify(breaches))
if (errors.length) console.log('PAGE ERRORS', JSON.stringify(errors.slice(0, 8)))
process.exitCode = breaches.length || errors.length ? 1 : 0
