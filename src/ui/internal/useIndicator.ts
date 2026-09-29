import { useLayoutEffect, type RefObject } from 'react'

/**
 * Moves an indicator element (the segmented thumb, the tab underline) under the selected item by
 * writing --x / --w on it. Re-measures when the container resizes (fonts loading, layout). The
 * first placement is not animated: data-ready is set one frame later. With no selected item the
 * indicator gets data-empty (hide it in CSS).
 */
export function useIndicator(
  container: RefObject<HTMLElement | null>,
  indicator: RefObject<HTMLElement | null>,
  selector: string,
  key: unknown,
): void {
  useLayoutEffect(() => {
    const box = container.current
    const bar = indicator.current
    if (!box || !bar) return
    const measure = () => {
      const item = box.querySelector<HTMLElement>(selector)
      if (!item) {
        bar.setAttribute('data-empty', '')
        return
      }
      bar.removeAttribute('data-empty')
      bar.style.setProperty('--x', `${item.offsetLeft}px`)
      bar.style.setProperty('--w', `${item.offsetWidth}px`)
    }
    measure()
    const frame = requestAnimationFrame(() => bar.setAttribute('data-ready', ''))
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(box)
    return () => {
      cancelAnimationFrame(frame)
      ro?.disconnect()
    }
  }, [container, indicator, selector, key])
}
