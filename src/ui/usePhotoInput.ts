import { useEffect } from 'react'
import { photo, uiBridge } from './bridge'
import { PHOTO_FILTERS, useUiStore } from './uiStore'
import { hasGameInput, isUiInput } from './gameKeys'

const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']

/** Cycles to the next photo look (F). */
function cyclePhotoFilter() {
  const ui = useUiStore.getState()
  ui.setPhotoFilter(PHOTO_FILTERS[(PHOTO_FILTERS.indexOf(ui.photoFilter) + 1) % PHOTO_FILTERS.length])
}

/** Camera input is ready immediately, including while the optional panel is loading. */
export function usePhotoInput(active: boolean) {
  useEffect(() => {
    if (!active) return
    const accepting = () => !uiBridge.graphicsBlocked && hasGameInput()
    const down = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.code.startsWith('Meta')) { photo.keys.clear(); return }
      if (!accepting() || isUiInput(event)) return
      const key = event.code
      if (MOVE_KEYS.includes(key)) { photo.keys.add(key); event.preventDefault(); return }
      if (event.repeat) return
      if (key === 'KeyF') { cyclePhotoFilter(); event.preventDefault() }
      else if (key === 'KeyV') { useUiStore.getState().setPhotoVignette(!useUiStore.getState().photoVignette); event.preventDefault() }
      else if (key === 'Enter') { photo.capture = true; event.preventDefault() }
    }
    const up = (event: KeyboardEvent) => { photo.keys.delete(event.code); if (event.metaKey || event.code.startsWith('Meta')) photo.keys.clear() }
    const move = (event: MouseEvent) => { if (document.pointerLockElement) { photo.dx += event.movementX; photo.dy += event.movementY } }
    const click = (event: MouseEvent) => { if (event.button === 0 && document.pointerLockElement) photo.capture = true }
    const wheel = (event: WheelEvent) => { if (accepting()) photo.zoom += Math.sign(event.deltaY) }
    const blur = () => photo.keys.clear()
    const lockChanged = () => { if (document.pointerLockElement !== uiBridge.canvas) blur() }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('mousemove', move)
    window.addEventListener('mousedown', click)
    window.addEventListener('wheel', wheel, { passive: true })
    window.addEventListener('blur', blur)
    document.addEventListener('pointerlockchange', lockChanged)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mousedown', click)
      window.removeEventListener('wheel', wheel)
      window.removeEventListener('blur', blur)
      document.removeEventListener('pointerlockchange', lockChanged)
      photo.keys.clear()
    }
  }, [active])
}
