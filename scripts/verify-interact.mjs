import { chromium } from 'playwright'
import fs from 'node:fs/promises'
// End-to-end interaction check against the dev server (npm run dev). Screenshots -> artifacts/interact/.
// Env: BASE_URL (default http://127.0.0.1:5173/), CHROME_PATH. Exits 1 when any check fails.
await fs.mkdir('artifacts/interact', { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--disable-gpu-vsync', '--disable-frame-rate-limit'] })
const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
const results = []
const check = (name, ok, detail = '') => { results.push([ok ? 'PASS' : 'FAIL', name, detail]); console.log(ok ? 'PASS' : 'FAIL', name, detail) }
const wait = (ms) => page.waitForTimeout(ms)
const shot = (name) => page.screenshot({ path: `artifacts/interact/${name}.png` })
const ui = () => page.evaluate(() => window.__ui.state())
const ix = () => page.evaluate(() => window.__interact.state())
const tele = () => page.evaluate(() => window.__playerSnapshot().telemetry)
const pos = () => page.evaluate(() => window.__playerSnapshot().telemetry.position)
const weather = () => page.evaluate(() => window.__weatherState())

await page.goto(new URL('?quality=high', process.env.BASE_URL || 'http://127.0.0.1:5173/').href, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'domcontentloaded' })
await wait(1500)
await shot('intro-loading')
await page.waitForFunction(() => document.body.innerText.includes('WORLD READY') && window.__playerSnapshot?.().characterReady?.male, null, { timeout: 180000 })
await wait(400)
await shot('intro')
check('intro enter button', await page.getByRole('button', { name: /进入仙宗/ }).isVisible())
await page.getByRole('button', { name: /进入仙宗/ }).click()
await page.evaluate(() => window.__ui.setDevInput(true))
await wait(2500)
await shot('hud')
const sites = await page.evaluate(() => window.__interact.sites())
const byKind = (kind) => sites.filter((s) => s.kind === kind)
console.log('sites', sites.length, Object.fromEntries(['stele', 'bell', 'altar', 'meditation', 'viewpoint', 'teleport'].map((k) => [k, byKind(k).map((s) => s.id).join(',')])))
check('compass rendered', await page.locator('.compass').isVisible())
check('orb counter text', /灵光\s*0\s*\/\s*60/.test(await page.locator('.orb-counter').innerText()), await page.locator('.orb-counter').innerText())

// Draw-call accounting: P6 objects on vs off at a few spots.
const drawDelta = async (label) => {
  await wait(900)
  const on = await tele()
  await page.evaluate(() => window.__interact.setVisible(false))
  await wait(900)
  const off = await tele()
  await page.evaluate(() => window.__interact.setVisible(true))
  console.log(`draws ${label}: on ${on.drawCalls} off ${off.drawCalls} delta ${on.drawCalls - off.drawCalls} fps ${Math.round(on.fps)} tris ${(on.triangles / 1e6).toFixed(2)}M`)
  return on.drawCalls - off.drawCalls
}
const deltas = [await drawDelta('spawn')]

const standAndPress = async (id) => {
  await page.evaluate((i) => window.__interact.standAt(i), id)
  await wait(900)
  const near = await page.evaluate(() => window.__interact.nearby())
  await page.keyboard.press('e')
  await wait(700)
  return near?.id
}

// Stele -> lore card + codex.
const stele = byKind('stele')[0]
check('prompt shows at stele', (await standAndPress(stele.id)) === stele.id)
await page.keyboard.press('Escape')
await wait(300)
await page.evaluate((i) => window.__interact.standAt(i), stele.id)
await wait(900)
await shot('prompt')
check('prompt text', /E\s*研读/.test(await page.locator('.interact-prompt').innerText().catch(() => '')), await page.locator('.interact-prompt').innerText().catch(() => 'none'))
deltas.push(await drawDelta('stele'))
await page.keyboard.press('e')
await wait(800)
check('lore overlay', (await ui()).overlay?.kind === 'lore')
check('lore dialog role', await page.locator('[role="dialog"].lore-dialog').isVisible())
await shot('lore')
await page.keyboard.press('e')
await wait(400)
check('lore closed by E', (await ui()).overlay === null)

// Bell.
const bell = byKind('bell')[0]
if (bell) { await standAndPress(bell.id); await wait(250); await shot('bell') }

// Altar -> weather picker.
const altar = byKind('altar')[0]
await standAndPress(altar.id)
check('weather overlay', (await ui()).overlay?.kind === 'weather')
await shot('weather')
const before = (await weather()).target
const pick = await page.locator('.weather-grid button[aria-pressed="false"]').nth(1)
const pickLabel = await pick.getAttribute('aria-label')
await pick.click()
await wait(600)
const after = (await weather()).target
check('weather target changed', before !== after, `${before} -> ${after} (${pickLabel})`)
// 顺其自然
await standAndPress(altar.id)
await page.getByRole('button', { name: /顺其自然/ }).click()
await wait(300)
check('auto weather restored', await page.evaluate(() => window.__ui && true) && (await ui()).autoWeather)
await page.evaluate(() => window.__setWeather('clear', true))

// Teleport: attune two arrays, travel between them.
const arrays = byKind('teleport')
const [homeArray, farArray] = [arrays[0], arrays[1]]
await page.evaluate((i) => window.__interact.standAt(i), farArray.id)
await wait(1200)
await page.evaluate((i) => window.__interact.standAt(i), homeArray.id)
await wait(1200)
check('arrays attuned', (await ix()).arrays.length >= 2, JSON.stringify((await ix()).arrays))
deltas.push(await drawDelta('array'))
await page.keyboard.press('e')
await wait(700)
check('teleport overlay', (await ui()).overlay?.kind === 'teleport')
await shot('teleport')
await page.locator('.array-list button[data-state="active"]').first().click()
await wait(350)
await shot('teleport-flash')
await wait(1400)
const arrived = await pos()
const dist = Math.hypot(arrived[0] - farArray.position[0], arrived[2] - farArray.position[2])
check('teleported to far array', dist < 6, `${farArray.id} dist ${dist.toFixed(2)} at ${arrived.map((v) => v.toFixed(1))}`)
await wait(600)
await shot('teleport-arrive')

// Meditation: time advances.
const cushion = byKind('meditation')[0]
const h0 = (await weather()).hours
await standAndPress(cushion.id)
check('meditation shot', (await ix()).shot === 'meditation')
await wait(3500)
await shot('meditation')
await wait(5500)
const h1 = (await weather()).hours
const advanced = ((h1 - h0) % 24 + 24) % 24
check('time advanced ~6h', advanced > 4 && advanced < 8, `${h0.toFixed(2)} -> ${h1.toFixed(2)} (+${advanced.toFixed(2)}h)`)
check('meditation ended', (await ix()).shot === null && (await ui()).cameraMode === 'player')
await page.evaluate(() => window.__setTimeOfDay(10.5))

// Viewpoint: cinematic, caption, reveal, skip with Esc.
const view = byKind('viewpoint')[0]
await standAndPress(view.id)
check('viewpoint shot', (await ix()).shot === 'viewpoint' && (await ui()).cameraMode === 'cinematic')
await wait(3200)
await shot('viewpoint')
check('caption visible', await page.locator('.cinema-caption').isVisible())
await page.keyboard.press('Escape')
await wait(1500)
check('viewpoint skipped', (await ix()).shot === null && (await ui()).cameraMode === 'player' && (await ui()).viewpoints >= 1)

// Orbs: visit the walkable (gold) ones.
const orbs = await page.evaluate(() => window.__interact.orbs())
const walk = orbs.map((o, i) => [o, i]).filter(([o]) => o.group === orbs[0].group).slice(0, 5)
for (const [, i] of walk) { await page.evaluate((n) => window.__interact.visitOrb(n), i); await wait(700) }
const got = (await ui()).orbs
check('orbs collected', got >= 3, `${got} of ${walk.length} visited (group ${orbs[0].group})`)
check('orb counter updates', (await page.locator('.orb-counter b').innerText()) === String(got))
await shot('orbs')

// Scroll: map / codex / collection.
await page.evaluate((i) => window.__interact.standAt(i), homeArray.id)
await wait(800)
await page.keyboard.press('Tab')
await wait(700)
check('scroll open', (await ui()).overlay?.kind === 'scroll')
await shot('map')
await page.getByRole('tab', { name: /碑录/ }).click()
await wait(300)
await shot('codex')
await page.keyboard.press('ArrowRight')
await wait(300)
check('arrow switches tab', (await page.getByRole('tab', { selected: true }).innerText()).includes('收集'))
await shot('collection')
await page.keyboard.press('Tab')
await wait(400)
check('scroll closed by Tab', (await ui()).overlay === null)

// Photo mode.
await page.keyboard.press('p')
await wait(600)
check('photo mode', (await ui()).cameraMode === 'photo')
await page.keyboard.press('f')
await page.keyboard.down('w'); await wait(500); await page.keyboard.up('w')
await wait(300)
await shot('photo')
const download = page.waitForEvent('download', { timeout: 5000 }).catch(() => null)
await page.keyboard.press('Enter')
const file = await download
await wait(600)
check('photo exported', (await ui()).photos >= 1 && file !== null, file ? file.suggestedFilename() : 'no download')
if (file) await file.saveAs('artifacts/interact/photo-export.png')
await page.keyboard.press('p')
await wait(500)
check('photo exit', (await ui()).cameraMode === 'player')

// H hides the HUD.
await page.keyboard.press('h')
await wait(300)
check('hud hidden', (await ui()).hudHidden && !(await page.locator('.compass').isVisible()))
await shot('hud-hidden')
await page.keyboard.press('h')
await wait(300)

// Settings menu (pointer lock lost, no dev input).
await page.evaluate(() => { document.exitPointerLock(); window.__ui.setDevInput(false) })
await wait(700)
check('settings open', (await ui()).settingsOpen)
await shot('settings')
const focused = await page.evaluate(() => document.activeElement?.className ?? '')
check('settings focus on resume', focused.includes('settings-resume'), focused)
const fov0 = (await ui()).fov
await page.getByRole('slider', { name: '视野角度' }).focus()
await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight')
const fov1 = (await ui()).fov
check('fov slider by keyboard', fov1 === fov0 + 2, `${fov0} -> ${fov1}`)
await page.getByRole('button', { name: '4×' }).click()
const scale = (await ui()).timeScale
check('time scale 4x', scale === 4)
await page.getByRole('button', { name: '1×' }).click()
await page.evaluate(() => window.__ui.setDevInput(true))
await wait(400)
check('settings closed', !(await ui()).settingsOpen)

const saved = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('yunque') || k.includes('save')))
check('save written', saved.length > 0, saved.join(','))

console.log('draw deltas', deltas.join(', '))
console.log('errors', errors.slice(0, 8))
const failed = results.filter(([r]) => r === 'FAIL')
console.log(`${results.length - failed.length}/${results.length} passed`)
await browser.close()
process.exit(failed.length ? 1 : 0)
