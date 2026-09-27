import type { ProfilerOnRenderCallback } from 'react'

/** DEV React commit measurements, reset by the UI regression script. */
export const uiRenderProfile: Record<string, { commits: number; milliseconds: number }> = {}
export const recordUiRender: ProfilerOnRenderCallback = (id, _, duration) => {
  if (!import.meta.env.DEV) return
  const record = uiRenderProfile[id] ??= { commits: 0, milliseconds: 0 }
  record.commits++; record.milliseconds += duration
}
