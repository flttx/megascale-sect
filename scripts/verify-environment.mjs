import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const base = process.env.BASE_URL || 'http://127.0.0.1:5174/'
const out = 'artifacts/t02r'
await fs.mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--use-angle=d3d11'] })
const views = [
  { name: 'A-spawn', eye: [0, 1.75, 150], look: [0, 69, -255] },
  { name: 'B-gate', eye: [0, 1.75, 86], look: [0, 20, -45] },
  { name: 'C-stairs', eye: [0, 4.85, 9], look: [0, 27, -100] },
  { name: 'D-platform', eye: [100, 25.75, -120], look: [0, 97, -320] },
  { name: 'E-flight', eye: [310, 125, 150], look: [0, -22, -250] },
  { name: 'F-side', eye: [690, 170, 5], look: [0, -30, -295] },
]
const report = { views, before: [], after: [], errors: [], geometry: {}, protectedFiles: [] }
try {
  for (const mode of ['before', 'after']) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    // Review captures hide all UI; remote font delivery must not gate geometry QA.
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
    page.on('pageerror', e => report.errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()) })
    await page.goto(`${base}${mode === 'before' ? '?env=graybox' : ''}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.body.innerText.includes('WORLD READY'), null, { timeout: 120000 })
    await page.waitForFunction(() => window.__playerSnapshot?.().characterReady.female && window.__environmentReview)
    await page.getByRole('button', { name: /进入仙宗/ }).click()
    // Keep the actual runtime materials, lighting, exposure and fog identical.
    await page.addStyleTag({ content: '.hud, .crosshair, .resume-button, .debug-hud, .intro, .interface, .topbar, .bottom-bar, .journey-card, .mode-card, .character-switcher, .controls-hint { visibility: hidden !important; }' })
    await page.waitForTimeout(1000)
    for (const view of views) {
      await page.evaluate(v => window.__environmentReview(v.eye, v.look), view)
      await page.waitForTimeout(450)
      const frameTimes = await page.evaluate(() => new Promise(resolve => {
        let previous = performance.now(); const times = []
        function next(t) { times.push(t - previous); previous = t; if (times.length < 70) requestAnimationFrame(next); else resolve(times.slice(10)) }
        requestAnimationFrame(next)
      }))
      const stats = await page.evaluate(() => window.__environmentStats())
      const average = frameTimes.reduce((a, b) => a + b) / frameTimes.length
      report[mode].push({ name: view.name, ...stats, fps: 1000 / average, p95FrameMs: frameTimes.sort((a,b) => a-b)[Math.floor(frameTimes.length * .95)] })
      await page.screenshot({ path: `${out}/${mode}-${view.name}.png` })
    }
    if (mode === 'after') {
      report.geometry = await page.evaluate(async () => {
        const { terrainHeight, roadAt } = await import('/src/world/environment/t02r/terrain.ts')
        let platformError = 0, pathError = 0, minRoadWidth = Infinity, maxRoadWidth = 0, colliderCoverage = true
        for (let x = -189; x <= 189; x += 7) for (let z = -514; z <= -66; z += 7) platformError = Math.max(platformError, Math.abs(terrainHeight(x,z) - 23.78))
        for (let z = 20; z <= 162; z += 1) {
          const r = roadAt(z); minRoadWidth = Math.min(minRoadWidth,r.width); maxRoadWidth = Math.max(maxRoadWidth,r.width)
          colliderCoverage &&= r.x-r.width/2 <= -8 && r.x+r.width/2 >= 8
          for (const x of [-8,0,8]) pathError = Math.max(pathError, Math.abs(terrainHeight(x,z)+.2))
        }
        return { platformError, pathError, minRoadWidth, maxRoadWidth, colliderCoverage }
      })
      assert.ok(report.geometry.platformError < .03, 'Tower slopes must not protrude through the playable platform')
      assert.ok(report.geometry.pathError < .01 && report.geometry.colliderCoverage, 'Carved road must cover the protected ground collider')
      const data = await page.evaluate(() => window.__environmentExport())
      await fs.writeFile('environment-pipeline/runtime-environment.json', JSON.stringify(data))
      assert.ok(report.after[0].terrainTriangles < 450000)
      assert.ok(report.after[0].rockInstances > 100)
      assert.ok(data.scatter.every(r => r.roadDistance > 10 && r.buildingDistance > 0))
    }
    await page.close()
  }
  assert.deepEqual(report.errors, [])
  const hashes = JSON.parse((await fs.readFile(`${out}/backup/protected-hashes.json`, 'utf8')).replace(/^\uFEFF/,''))
  for (const record of hashes) {
    const actual = createHash('sha256').update(await fs.readFile(record.Path)).digest('hex').toUpperCase()
    assert.equal(actual, record.Hash, `Protected file changed: ${record.Path}`)
    report.protectedFiles.push(record.Path)
  }
  console.log(JSON.stringify(report, null, 2))
} finally {
  await fs.writeFile(`${out}/review-report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
