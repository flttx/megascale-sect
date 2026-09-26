import fs from 'node:fs/promises'
import { openWorld } from './lib/world-session.mjs'

// Ad-hoc audit: play from the player's camera and capture key moments.
const OUT = process.env.OUT || 'artifacts/audit'
await fs.mkdir(OUT, { recursive: true })
const { browser, page, errors } = await openWorld(process.env.Q || '?quality=high&hours=15&weather=clear')
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` })
const hold = async (keys, ms) => { for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(ms); for (const k of keys) await page.keyboard.up(k) }
await page.mouse.move(800, 450)
await shot('01-spawn')
await hold(['w'], 2500); await shot('02-walk')
await hold(['w', 'Shift'], 4000); await shot('03-run')
await page.keyboard.press('f'); await page.waitForTimeout(1300); await shot('04-summon')
await page.waitForTimeout(1500); await shot('05-mounted')
await hold(['w', ' '], 3000); await shot('06-fly-up')
await hold(['w', 'Shift'], 4000); await shot('07-fly-boost')
await hold(['w'], 5000); await shot('08-fly-near-hall')
await hold(['w', ' '], 4000); await shot('09-fly-high')
const snap = await page.evaluate(() => window.__playerSnapshot().telemetry)
console.log(JSON.stringify({ snap, errors }, null, 1))
await browser.close()
