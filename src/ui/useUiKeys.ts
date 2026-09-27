import { useEffect } from 'react'
import { interactPressed } from '../world/interact/actions'
import { director, endShot } from '../world/interact/cinematics'
import { useWorldStore } from '../world/store'
import { enterPhoto, exitPhoto, uiBridge } from './bridge'
import { dismissOverlay, showOverlay, useUiStore } from './uiStore'
import { isUiInput } from './gameKeys'

/**
 * Global game-UI keys: E interact, Tab scroll, P photo mode, H hide HUD, Esc back out of shots/overlays.
 * Open dialogs handle Esc/Tab themselves (and stop them), so these only see keys meant for the world.
 */
export function useUiKeys() {
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (uiBridge.graphicsBlocked || event.repeat || event.metaKey || event.ctrlKey) return
      const key = event.code
      const world = useWorldStore.getState(), ui = useUiStore.getState()
      if (key === 'KeyE' && ui.overlay?.kind === 'lore' && !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]'))) { dismissOverlay(); return }
      if (isUiInput(event)) return
      const inputOk = world.locked || (import.meta.env.DEV && ui.devInput)
      const playing = world.started && world.cameraMode === 'player' && inputOk
      if (key === 'Tab' && playing) event.preventDefault()
      if (world.cameraMode === 'photo') {
        if (key === 'KeyP' || key === 'Escape') { event.preventDefault(); exitPhoto(key === 'Escape') }
        else if (key === 'KeyH') ui.setHudHidden(!ui.hudHidden)
        return
      }
      switch (key) {
        case 'KeyE': if (playing) interactPressed(); break
        case 'Tab':
          if (ui.overlay?.kind === 'scroll') dismissOverlay()
          else if (!ui.overlay && playing) showOverlay({ kind: 'scroll' })
          break
        case 'KeyP':
          if (playing && !ui.overlay && !director.shot) enterPhoto()
          break
        case 'KeyH':
          if (world.started) ui.setHudHidden(!ui.hudHidden)
          break
        case 'Escape':
          if (ui.photoUnlocked) useUiStore.setState({ photoUnlocked: false })
          if (director.shot) endShot()
          else if (ui.overlay) dismissOverlay()
          break
      }
    }
    // A click skips a viewpoint sweep (meditation ends only on E, so a stray click doesn't wake you).
    const click = (event: MouseEvent) => { if (event.button === 0 && director.shot?.kind === 'viewpoint') endShot() }
    window.addEventListener('keydown', down)
    window.addEventListener('mousedown', click)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('mousedown', click)
    }
  }, [])
}
