/** Native controls keep their own Space, Tab and letter-key behaviour. */
export function isUiInput(event: KeyboardEvent) {
  return event.target instanceof Element && !!event.target.closest('.interface button, .interface input, .interface select, .interface textarea, [contenteditable="true"], [role="dialog"]')
}
import { uiBridge } from './bridge'
import { useUiStore } from './uiStore'

/** Pointer-lock events can reach the store after the next key; the browser is authoritative. */
export const hasGameInput = () => (!!uiBridge.canvas && document.pointerLockElement === uiBridge.canvas) || (import.meta.env.DEV && useUiStore.getState().devInput)
