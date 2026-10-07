import { useGLTF } from '@react-three/drei'
import { create } from 'zustand'
import { eldritchAssetUrls, setEldritchAssetStatus, type EldritchAssetStatus } from './eldritchAssets'

export type EldritchLoadingStatus = 'idle' | 'loading' | 'ready' | 'error'

interface EldritchLoadingState {
  status: EldritchLoadingStatus
  attempt: number
}

/** Low-frequency asset state shared by the scene and its DOM loading controls. */
export const useEldritchLoadingStore = create<EldritchLoadingState>(() => ({ status: 'idle', attempt: 0 }))

function setAssetStatuses(status: EldritchAssetStatus) {
  setEldritchAssetStatus('eye', status)
  setEldritchAssetStatus('tentacle', status)
}

function startPreload(attempt: number) {
  setAssetStatuses('loading')
  useEldritchLoadingStore.setState({ status: 'loading', attempt })
  try {
    // This is called only after the player selects or enters black-mist mode.
    // Readiness is committed by the boundary after all models and textures resolve.
    useGLTF.preload(eldritchAssetUrls())
  } catch {
    markEldritchAssetsError(attempt)
  }
}

/** Idempotent selection-time preload; importing this module never requests a GLB. */
export function preloadEldritchAssets() {
  const state = useEldritchLoadingStore.getState()
  if (state.status === 'idle') startPreload(state.attempt)
}

/** Retry only the eight optional creature LODs, preserving the world and cinematic progress. */
export function retryEldritchAssets() {
  const urls = eldritchAssetUrls()
  // The landmarks and ready probe use the grouped key. Clear individual keys too
  // so callers cannot retain a failed single-model request after an explicit retry.
  useGLTF.clear(urls)
  urls.forEach((url) => useGLTF.clear(url))
  startPreload(useEldritchLoadingStore.getState().attempt + 1)
}

export function markEldritchAssetsReady(attempt: number) {
  const state = useEldritchLoadingStore.getState()
  if (state.attempt !== attempt || state.status === 'error') return
  setAssetStatuses('ready')
  if (state.status !== 'ready') useEldritchLoadingStore.setState({ status: 'ready' })
}

export function markEldritchAssetsError(attempt: number) {
  const state = useEldritchLoadingStore.getState()
  if (state.attempt !== attempt) return
  setAssetStatuses('error')
  if (state.status !== 'error') useEldritchLoadingStore.setState({ status: 'error' })
}
