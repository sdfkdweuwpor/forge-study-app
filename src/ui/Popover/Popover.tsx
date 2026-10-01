import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEventHandler,
  type ReactNode,
  type RefCallback,
} from 'react'
import { useControllable } from '../internal/useControllable'
import { FloatingLayer } from './FloatingLayer'
import { focusInside } from './focus'
import type { Align, Side } from './position'
import styles from './Popover.module.css'

/** Spread these onto the trigger element. Its ref must reach a DOM element. */
export interface PopoverTriggerProps {
  ref: RefCallback<HTMLElement>
  onClick: MouseEventHandler<HTMLElement>
  'aria-haspopup': 'dialog'
  'aria-expanded': boolean
  'aria-controls': string | undefined
}

export interface PopoverContext {
  close: () => void
}

export interface PopoverProps {
  /** Renders the trigger, e.g. `(p) => <Button {...p}>Due date</Button>`. */
  trigger: (props: PopoverTriggerProps) => ReactNode
  children: ReactNode | ((ctx: PopoverContext) => ReactNode)
  /** Accessible name. Giving one makes the panel `role="dialog"`. */
  label?: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  side?: Side
  align?: Align
  offset?: number
  /** Make the panel at least as wide as the trigger. */
  matchTriggerWidth?: boolean
  className?: string
}

/**
 * A panel anchored to its trigger. Portaled to <body>, flips and shifts to stay on screen, closes
 * on outside press and Esc, moves focus in on open (first `[data-autofocus]` or tabbable element)
 * and back to the trigger on close. Tabbing out closes it and continues from the trigger.
 */
export function Popover({
  trigger,
  children,
  label,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  side,
  align,
  offset,
  matchTriggerWidth,
  className,
}: PopoverProps) {
  const [open, setOpen] = useControllable(openProp, defaultOpen, onOpenChange)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const id = useId()
  const contentEl = useRef<HTMLDivElement | null>(null)

  // Focus in on open. On close, focus goes back to the trigger unless the user has already moved
  // it somewhere on purpose (an outside click on another control, or Tab-out, which hands focus to
  // the trigger itself before closing).
  useEffect(() => {
    if (!open || !content) return undefined
    // After a frame, so the panel has been placed and is visible.
    const frame = requestAnimationFrame(() => focusInside(content))
    return () => cancelAnimationFrame(frame)
  }, [open, content])

  useEffect(() => {
    if (!open) return undefined
    return () => {
      const active = document.activeElement
      const stillInside =
        active === null || active === document.body || contentEl.current?.contains(active)
      if (stillInside) anchor?.focus({ preventScroll: true })
    }
  }, [open, anchor])

  const setContentRefs = useCallback((node: HTMLDivElement | null) => {
    contentEl.current = node
    setContent(node)
  }, [])

  const close = useCallback(() => setOpen(false), [setOpen])

  const triggerProps: PopoverTriggerProps = {
    ref: setAnchor,
    onClick: () => setOpen(!open),
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    'aria-controls': open ? id : undefined,
  }

  return (
    <>
      {trigger(triggerProps)}
      <FloatingLayer
        open={open}
        anchor={anchor}
        onDismiss={close}
        side={side}
        align={align}
        offset={offset}
        matchAnchorWidth={matchTriggerWidth}
        contentRef={setContentRefs}
        id={id}
        role={label ? 'dialog' : undefined}
        aria-label={label}
        className={className}
      >
        {typeof children === 'function' ? children({ close }) : children}
      </FloatingLayer>
    </>
  )
}

/** Vertical stack with the spacing popover content usually wants. */
export function PopoverBody({ children }: { children: ReactNode }) {
  return <div className={styles.body}>{children}</div>
}
