import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import path from 'node:path'

export function chromePath() {
  if (process.env.CHROME_PATH) {
    if (!existsSync(process.env.CHROME_PATH)) throw new Error(`CHROME_PATH does not exist: ${process.env.CHROME_PATH}`)
    return process.env.CHROME_PATH
  }
  const candidates = process.platform === 'win32' ? [
    ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
      .map((root) => path.join(root, 'Google/Chrome/Application/chrome.exe')),
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  candidates.push(chromium.executablePath())
  const found = candidates.find(existsSync)
  if (!found) throw new Error('Chrome/Chromium was not found. Set CHROME_PATH or run npx playwright install chromium.')
  return found
}

export function launchBrowser(options = {}) {
  const args = (options.args ?? []).filter((arg) => process.platform === 'win32' || arg !== '--use-angle=d3d11')
  return chromium.launch({ headless: true, ...options, executablePath: chromePath(), args })
}
