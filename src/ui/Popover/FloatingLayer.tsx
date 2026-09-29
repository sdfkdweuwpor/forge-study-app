import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type RefCallback,
} from 'react'
import { useOverlayPresence } from '../Modal/ModalPresence'
import { getFocusable } from './focus'
import { OverlayPortal } from './OverlayPortal'
import { PopoverPanel } from './PopoverPanel'
import { useLayer } from './layers'
import type { Align, Side } from './position'
import { usePresence } from './usePresence'
import { useAnchoredPosition } from './useAnchoredPosition'

export type DismissReason = 'escape' | 'outside' | 'tab'

/** Matches pop-out (--dur-1) in Popover.module.css, plus a little slack. */
const EXIT_MS = 140

interface FloatingLayerProps extends Omit<ComponentProps<'div'>, 'ref'> {
  open: boolean
  anchor: HTMLElement | null
  onDismiss: (reason: DismissReason) => void
  side?: Side
  align?: Align
  offset?: number
  /** Make the panel at least as wide as the anchor (select-like menus). */
  matchAnchorWidth?: boolean
  /** Receives the panel element while it is mounted. */
  contentRef?: RefCallback<HTMLDivElement>
  /** Any Tab leaves the layer (menus). By default only Tab past the first or last tabbable does. */
  closeOnAnyTab?: boolean
}

/**
 * Anchored, portaled, dismissable layer: presence (exit animation), placement with flip and shift,
 * outside press, Escape (topmost layer only) and Tab-out. What goes inside, and how focus moves,
 * is up to Popover and Dropdown.
 */
export function FloatingLayer({
  open,
  anchor,
  onDismiss,
  side = 'bottom',
  align = 'start',
  offset,
  matchAnchorWidth,
  contentRef,
  closeOnAnyTab,
  style,
  onKeyDown,
  onPointerDownCapture,
  children,
  ...rest
}: FloatingLayerProps) {
  const mounted = usePresence(open, EXIT_MS)
  const [panel, setPanel] = useState<HTMLDivElement | null>(null)
  const position = useAnchoredPosition({
    anchor,
    floating: panel,
    active: mounted,
    side,
    align,
    offset,
  })

  useLayer(open, () => onDismiss('escape'))
  // While a menu or popover is open the page's own keys (`x` completes, `j` moves) stay quiet; the
  // app turns this announcement into a blocking shortcut scope.
  useOverlayPresence(open, 'menu')

  // Outside press. Nested overlays are portaled elsewhere in the DOM but sit inside this panel in
  // the React tree, so React's capture phase marks presses that belong to this layer.
  const pressedInside = useRef(false)
  const dismiss = useRef(onDismiss)
  useEffect(() => {
    dismiss.current = onDismiss
  })
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (e: PointerEvent) => {
      const inside = pressedInside.current
      pressedInside.current = false
      if (inside) return
      const target = e.target
      if (target instanceof Node && (panel?.contains(target) || anchor?.contains(target))) return
      dismiss.current('outside')
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, panel, anchor])

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setPanel(node)
      contentRef?.(node)
    },
    [contentRef],
  )

  if (!mounted) return null

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented || e.key !== 'Tab' || !open) return
    // Tabbing out of a non-modal layer hands focus back to the trigger and lets the browser carry
    // on from there, so Tab continues with the element after the trigger.
    const focusables = getFocusable(e.currentTarget)
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    const leaving = closeOnAnyTab
      ? true
      : e.shiftKey
        ? first === undefined || active === first || active === e.currentTarget
        : last === undefined || active === last
    if (!leaving) return
    anchor?.focus({ preventScroll: true })
    onDismiss('tab')
  }

  return (
    <OverlayPortal origin={anchor}>
      <PopoverPanel
        {...rest}
        ref={setRefs}
        data-state={open ? 'open' : 'closed'}
        data-side={position?.side ?? side}
        style={{
          ...style,
          left: position?.x ?? 0,
          top: position?.y ?? 0,
          maxHeight: position?.maxHeight,
          minWidth: matchAnchorWidth ? anchor?.offsetWidth : undefined,
          transformOrigin: position ? `${position.origin.x}px ${position.origin.y}px` : undefined,
          visibility: position ? undefined : 'hidden',
        }}
        onKeyDown={handleKeyDown}
        onPointerDownCapture={(e) => {
          pressedInside.current = true
          onPointerDownCapture?.(e)
        }}
      >
        {children}
      </PopoverPanel>
    </OverlayPortal>
  )
}
