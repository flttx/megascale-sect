import { useEffect } from 'react'
import { interactPressed } from '../world/interact/actions'
import { director, endShot } from '../world/interact/cinematics'
import { useWorldStore } from '../world/store'
import { enterPhoto, exitPhoto } from './bridge'
import { dismissOverlay, showOverlay, useUiStore } from './uiStore'

/**
 * Global game-UI keys: E interact, Tab scroll, P photo mode, H hide HUD, Esc back out of shots/overlays.
 * Open dialogs handle Esc/Tab themselves (and stop them), so these only see keys meant for the world.
 */
export function useUiKeys() {
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (key === 'tab') event.preventDefault()
      if (event.repeat) return
      const world = useWorldStore.getState(), ui = useUiStore.getState()
      const inputOk = world.locked || (import.meta.env.DEV && ui.devInput)
      const playing = world.started && world.cameraMode === 'player' && inputOk
      if (world.cameraMode === 'photo') {
        if (key === 'p' || key === 'escape') { event.preventDefault(); exitPhoto() }
        else if (key === 'h') ui.setHudHidden(!ui.hudHidden)
        return
      }
      switch (key) {
        case 'e': interactPressed(); break
        case 'tab':
          if (ui.overlay?.kind === 'scroll') dismissOverlay()
          else if (!ui.overlay && playing) showOverlay({ kind: 'scroll' })
          break
        case 'p':
          if (playing && !ui.overlay && !director.shot) enterPhoto()
          break
        case 'h':
          if (world.started) ui.setHudHidden(!ui.hudHidden)
          break
        case 'escape':
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
