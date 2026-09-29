import { useWorldStore } from '../world/store'
import { photo } from './bridge'
import { PHOTO_FILTER_CSS, useUiStore } from './uiStore'
import { translate } from './i18n'

const pad = (n: number) => String(n).padStart(2, '0')
let shotSequence = 0

/**
 * Copies the frame just presented on the WebGL canvas into a PNG, replaying the photo look (CSS filter
 * string and vignette) through a 2D canvas so the download matches what the player sees.
 */
export function exportPhoto(source: HTMLCanvasElement) {
  const { photoFilter, photoVignette } = useUiStore.getState()
  const fail = (error?: unknown) => {
    if (error) console.warn('[photo] capture failed', error)
    useWorldStore.getState().setNotice('照片保存失败，请稍后再试')
  }
  try {
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    const context = canvas.getContext('2d')
    if (!context) { fail(); return }
    context.filter = PHOTO_FILTER_CSS[photoFilter]
    context.drawImage(source, 0, 0)
    context.filter = 'none'
    const { width, height } = canvas
    if (photoVignette) {
      const gradient = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.36, width / 2, height / 2, Math.hypot(width, height) / 2)
      gradient.addColorStop(0, 'rgba(8, 12, 18, 0)')
      gradient.addColorStop(1, 'rgba(8, 12, 18, 0.62)')
      context.fillStyle = gradient
      context.fillRect(0, 0, width, height)
    }
    // A quiet seal in the corner, like a painter's chop.
    const size = Math.round(height * 0.028)
    context.font = `600 ${size}px 'Noto Sans SC', 'Microsoft YaHei', sans-serif`
    context.fillStyle = 'rgba(236, 219, 185, 0.78)'
    context.textAlign = 'right'
    context.fillText(translate('云阙仙宗', useUiStore.getState().language), width - size * 1.4, height - size * 1.3)
    const now = new Date()
    const name = `yunque-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${String(now.getMilliseconds()).padStart(3, '0')}-${++shotSequence}.png`
    useUiStore.getState().shutter()
    canvas.toBlob((blob) => {
      if (!blob) { fail(); return }
      photo.count++
      photo.last = { name, width, height, bytes: blob.size, filter: photoFilter }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    }, 'image/png')
  } catch (error) {
    fail(error)
  }
}
