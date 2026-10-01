import { useEffect, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * While `active`: moves focus into `container` (the first `[data-autofocus]` or focusable element)
 * and returns it to the previously focused element on close. Background content should be `inert`.
 */
export function useModalFocus(active: boolean, container: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return undefined
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = container.current
    const target =
      root?.querySelector<HTMLElement>('[data-autofocus]') ??
      root?.querySelector<HTMLElement>(FOCUSABLE)
    // Wait a frame so the panel is visible (visibility transitions) before focusing.
    const raf = requestAnimationFrame(() => target?.focus({ preventScroll: true }))
    return () => {
      cancelAnimationFrame(raf)
      previous?.focus({ preventScroll: true })
    }
  }, [active, container])
}
