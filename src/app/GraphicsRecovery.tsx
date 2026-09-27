import { useCallback, useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { flushSave, safePosition } from '../ui/save'
import { exitPhoto, releaseLock, uiBridge } from '../ui/bridge'
import { useUiStore } from '../ui/uiStore'
import { useWorldStore } from '../world/store'
import { director } from '../world/interact/cinematics'
import { getPlayerRuntime, teleportPlayer } from '../world/player/playerHandle'

type Status = 'ready' | 'lost' | 'rebuilding' | 'failed'

/** Keep progress/settings outside Canvas; rebuild GPU resources once a lost context is available again. */
export function useGraphicsRecovery() {
  const [epoch, setEpoch] = useState(0)
  const [status, setStatus] = useState<Status>('ready')
  const current = useRef<Status>('ready')
  const checkpoint = useRef<ReturnType<typeof safePosition> | null>(null)
  const timer = useRef(0)
  const detach = useRef<(() => void) | null>(null)
  const transition = useCallback((next: Status) => { current.current = next; setStatus(next) }, [])
  const deadline = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => transition('failed'), 12000)
  }, [transition])
  const retry = useCallback(() => {
    detach.current?.(); detach.current = null
    transition('rebuilding'); deadline()
    setEpoch((value) => value + 1)
  }, [deadline, transition])
  const attach = useCallback((canvas: HTMLCanvasElement) => {
    detach.current?.()
    uiBridge.canvas = canvas
    const lost = (event: Event) => {
      event.preventDefault()
      if (current.current === 'lost' || current.current === 'failed') return
      uiBridge.graphicsBlocked = true
      flushSave(); checkpoint.current = safePosition()
      releaseLock(); useWorldStore.getState().setLocked(false)
      window.dispatchEvent(new Event('blur'))
      exitPhoto(); director.shot = null
      useWorldStore.getState().setCameraMode('player')
      useUiStore.setState({ overlay: null, veil: false, caption: null, nearby: null, photoUnlocked: false, lockError: null })
      transition('lost'); deadline()
    }
    const restored = () => { if (current.current === 'lost') retry() }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)
    detach.current = () => {
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
    }
  }, [deadline, retry, transition])
  const ready = useCallback(() => {
    if (current.current !== 'rebuilding') return
    const p = checkpoint.current ?? safePosition()
    if (!teleportPlayer([p.x, p.y + 0.2, p.z], p.yaw)) return
    window.clearTimeout(timer.current)
    uiBridge.graphicsBlocked = false
    transition('ready')
    useWorldStore.getState().setNotice('画面已恢复，已回到最近的安全落脚点')
  }, [transition])
  useEffect(() => () => {
    window.clearTimeout(timer.current); detach.current?.(); uiBridge.graphicsBlocked = false
  }, [])
  return { epoch, status, attach, ready, retry }
}

/** Wait for the replacement player, surface registrations and a few rendered frames. */
export function RecoveryProbe({ active, onReady }: { active: boolean; onReady: () => void }) {
  const frames = useRef(0)
  useFrame(() => {
    if (!active) { frames.current = 0; return }
    if (++frames.current >= 3 && getPlayerRuntime()?.ready) onReady()
  })
  return null
}

export function RecoveryOverlay({ status, retry }: { status: Status; retry: () => void }) {
  if (status === 'ready') return null
  const failed = status === 'failed'
  return <div className="graphics-recovery" role="alertdialog" aria-modal="true" aria-labelledby="graphics-title">
    <div><h2 id="graphics-title">{failed ? '画面暂未恢复' : '正在恢复画面'}</h2>
      <p>{failed ? '进度与设置仍保留在本次会话中。请点击重试。' : '正在重建画面，稍后将在最近的安全落脚点继续。'}</p>
      {failed && <button autoFocus onClick={retry}>重试恢复画面</button>}
    </div>
  </div>
}
