import { useCallback, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { useWorldStore } from './store'

export type QualityLevel = 'low' | 'mid' | 'high'
export const QUALITY_LEVELS: QualityLevel[] = ['low', 'mid', 'high']

export interface QualityPreset {
  label: string
  /** Device-pixel-ratio range the adaptive scaler may move within. */
  dpr: [number, number]
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { label: '流畅', dpr: [0.7, 1] },
  mid: { label: '均衡', dpr: [0.85, 1.25] },
  high: { label: '极致', dpr: [1, 1.5] },
}

/**
 * Scales DPR inside the active preset's range from measured frame rate, and (when
 * auto quality is on) steps the preset down once DPR has bottomed out and frames still drop.
 * Sampling starts only after entering the world so asset loading hitches don't count.
 */
export function QualityManager() {
  const started = useWorldStore((state) => state.started)
  const quality = useWorldStore((state) => state.quality)
  const autoQuality = useWorldStore((state) => state.autoQuality)
  const setDpr = useThree((state) => state.setDpr)
  const [min, max] = QUALITY_PRESETS[quality].dpr
  // Never render above the display's native density; low tiers may render below it.
  const apply = useCallback((factor: number) => setDpr(Math.min(window.devicePixelRatio || 1, min + (max - min) * factor)), [setDpr, min, max])
  useEffect(() => apply(1), [apply])
  if (!started) return null
  return (
    <PerformanceMonitor
      key={quality}
      factor={1}
      step={0.2}
      onChange={({ factor }) => apply(factor)}
      onDecline={({ factor }) => {
        if (!autoQuality || factor > 0.01) return
        const index = QUALITY_LEVELS.indexOf(quality)
        if (index > 0) useWorldStore.getState().setQuality(QUALITY_LEVELS[index - 1], true)
      }}
    />
  )
}
