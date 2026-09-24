import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const NAV_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Home', 'End', 'PageUp', 'PageDown']

interface DialogProps {
  title: string
  /** Visually hidden heading when the dialog draws its own title. */
  hideTitle?: boolean
  className?: string
  onClose: () => void
  /** Clicking the dimmed backdrop closes (default true). */
  backdropCloses?: boolean
  /** Plain Tab calls this instead of moving focus (the scroll overlay closes on Tab); Shift+Tab still cycles. */
  onTab?: () => void
  children: ReactNode
}

/**
 * Modal shell: role="dialog" + aria-modal, focuses the first control on open and returns focus on close,
 * Esc closes, Tab wraps inside (trap-lite). Esc and Tab handled here never reach the game's global handlers.
 */
export function Dialog({ title, hideTitle = false, className = '', onClose, backdropCloses = true, onTab, children }: DialogProps) {
  const panel = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel.current)?.focus({ preventScroll: true })
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return }
    // The player's window handler cancels arrows/Space (camera keys); keep them for sliders and buttons here.
    if (NAV_KEYS.includes(event.key)) { event.stopPropagation(); return }
    if (event.key !== 'Tab') return
    event.stopPropagation()
    if (onTab && !event.shiftKey) { event.preventDefault(); onTab(); return }
    const items = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((item) => item.offsetParent !== null)
    if (!items.length) { event.preventDefault(); return }
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.shiftKey && index <= 0) { event.preventDefault(); items[items.length - 1].focus() }
    else if (!event.shiftKey && (index === -1 || index === items.length - 1)) { event.preventDefault(); items[0].focus() }
  }
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (backdropCloses && event.target === event.currentTarget) close.current() }}>
    <section ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`dialog ${className}`} onKeyDown={onKeyDown}>
      <h2 id={titleId} className={hideTitle ? 'visually-hidden' : 'dialog-title'}>{title}</h2>
      {children}
    </section>
  </div>
}
