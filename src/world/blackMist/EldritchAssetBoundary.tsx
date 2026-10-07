import { Component, Suspense, useLayoutEffect, type ReactNode } from 'react'
import { useGLTF } from '@react-three/drei'
import { eldritchAssetUrls } from './eldritchAssets'
import {
  markEldritchAssetsError,
  markEldritchAssetsReady,
  preloadEldritchAssets,
  useEldritchLoadingStore,
  type EldritchLoadingStatus,
} from './eldritchLoading'

const LOAD_DEADLINE_MS = 60_000

function ReadyProbe({ attempt, children }: { attempt: number; children: ReactNode }) {
  useGLTF(eldritchAssetUrls())
  useLayoutEffect(() => {
    markEldritchAssetsReady(attempt)
  }, [attempt])
  return children
}

interface ModelBoundaryProps {
  attempt: number
  status: EldritchLoadingStatus
  children: ReactNode
}

/** Isolate optional landmarks so their requests cannot suspend or discard the world. */
class ModelBoundary extends Component<ModelBoundaryProps, { failed: boolean }> {
  state = { failed: false }
  private deadline: ReturnType<typeof setTimeout> | null = null

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidMount() {
    if (this.state.failed) {
      markEldritchAssetsError(this.props.attempt)
      return
    }
    preloadEldritchAssets()
    // A selection-time preload does not start this timer. It runs only while the
    // mode is mounted, so a stalled request offers a retry without trapping the film.
    if (useEldritchLoadingStore.getState().status === 'loading') {
      this.deadline = setTimeout(() => {
        if (useEldritchLoadingStore.getState().status !== 'loading') return
        markEldritchAssetsError(this.props.attempt)
        this.setState({ failed: true })
      }, LOAD_DEADLINE_MS)
    }
  }

  componentDidUpdate() {
    if (this.props.status === 'ready' || this.props.status === 'error') this.clearDeadline()
  }

  componentDidCatch() {
    markEldritchAssetsError(this.props.attempt)
  }

  componentWillUnmount() {
    // Cached readiness survives quality changes, StrictMode and graphics recovery.
    this.clearDeadline()
  }

  private clearDeadline() {
    if (this.deadline !== null) clearTimeout(this.deadline)
    this.deadline = null
  }

  render() {
    if (this.state.failed || this.props.status === 'error') return null
    return (
      <Suspense fallback={null}>
        <ReadyProbe attempt={this.props.attempt}>{this.props.children}</ReadyProbe>
      </Suspense>
    )
  }
}

/** An explicit retry remounts only these landmarks, with all failed GLTF keys cleared. */
export function EldritchAssetBoundary({ children }: { children: ReactNode }) {
  const attempt = useEldritchLoadingStore((state) => state.attempt)
  const status = useEldritchLoadingStore((state) => state.status)
  return (
    <ModelBoundary key={attempt} attempt={attempt} status={status}>
      {children}
    </ModelBoundary>
  )
}
