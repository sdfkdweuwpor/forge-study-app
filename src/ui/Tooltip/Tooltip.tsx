import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../internal/cx'
import { useMergedRef } from '../internal/refs'
import { Kbd } from '../Kbd'
import { place, type Side } from './position'
import styles from './Tooltip.module.css'

/** Props the trigger element must accept: a DOM element, or a component that forwards `ref`. */
export interface TooltipTriggerProps {
  ref?: Ref<HTMLElement>
  'aria-describedby'?: string
}

export interface TooltipProps {
  content: ReactNode
  /** Shortcut hint shown as a Kbd, e.g. 'mod+k'. */
  shortcut?: string
  side?: Side
  /** Hover delay in ms. Keyboard focus opens at once; a second tooltip within 400ms skips it. */
  delay?: number
  /**
   * Adds aria-describedby on the trigger while open. Turn off when the content repeats the
   * trigger's accessible name (IconButton does, and sets aria-keyshortcuts instead).
   */
  describe?: boolean
  disabled?: boolean
  /** A single element that accepts a ref (a DOM element or a ref-forwarding component). */
  children: ReactElement<TooltipTriggerProps>
}

const GAP = 6
const MARGIN = 8
const SKIP_DELAY_MS = 400
const HIDE_GRACE_MS = 100
/** Shared by all tooltips: moving from one trigger to the next skips the delay (like macOS). */
let lastHiddenAt = Number.NEGATIVE_INFINITY

const INHERITED_ATTRS = ['data-theme', 'data-accent', 'data-reduced-motion'] as const

/**
 * Tooltip on hover (after `delay`) and keyboard focus. Esc, pointer down, blur and scrolling
 * dismiss it; the pointer can move onto it without closing it (WCAG 1.4.13). Rendered in a
 * portal and placed with `place()`; it copies the trigger's theme, accent and reduced-motion
 * attributes so it matches a themed sub-tree (the /design columns). Touch never opens it.
 */
export function Tooltip({
  content,
  shortcut,
  side = 'top',
  delay = 500,
  describe = true,
  disabled = false,
  children,
}: TooltipProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [trigger, setTrigger] = useState<HTMLElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const openTimer = useRef<number | undefined>(undefined)
  const closeTimer = useRef<number | undefined>(undefined)

  const clearTimers = useCallback(() => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
  }, [])

  const hide = useCallback(() => {
    clearTimers()
    setOpen(false)
  }, [clearTimers])

  const hideSoon = useCallback(() => {
    clearTimers()
    closeTimer.current = window.setTimeout(hide, HIDE_GRACE_MS)
  }, [clearTimers, hide])

  // Native listeners on the trigger: the child's own React handlers stay untouched.
  useEffect(() => {
    if (!trigger || disabled) return
    /** A pointer press answers the question: no tooltip until the pointer leaves. */
    let pressed = false
    const show = (immediate: boolean) => {
      clearTimers()
      const warm = performance.now() - lastHiddenAt < SKIP_DELAY_MS
      if (immediate || warm || delay <= 0) setOpen(true)
      else openTimer.current = window.setTimeout(() => setOpen(true), delay)
    }
    const onEnter = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' && !pressed) show(false)
    }
    const onLeave = () => {
      pressed = false
      hideSoon()
    }
    const onDown = () => {
      pressed = true
      hide()
    }
    const onFocus = () => {
      if (!pressed && trigger.matches(':focus-visible')) show(true)
    }
    const onBlur = () => {
      pressed = false
      hide()
    }
    trigger.addEventListener('pointerenter', onEnter)
    trigger.addEventListener('pointerleave', onLeave)
    trigger.addEventListener('pointerdown', onDown)
    trigger.addEventListener('focus', onFocus)
    trigger.addEventListener('blur', onBlur)
    return () => {
      clearTimers()
      trigger.removeEventListener('pointerenter', onEnter)
      trigger.removeEventListener('pointerleave', onLeave)
      trigger.removeEventListener('pointerdown', onDown)
      trigger.removeEventListener('focus', onFocus)
      trigger.removeEventListener('blur', onBlur)
    }
  }, [trigger, disabled, delay, clearTimers, hide, hideSoon])

  const isOpen = open && !disabled && trigger !== null

  useLayoutEffect(() => {
    if (!isOpen || !trigger) return
    const tip = tipRef.current
    if (!tip) return

    for (const attr of INHERITED_ATTRS) {
      const value = trigger.closest(`[${attr}]`)?.getAttribute(attr)
      if (value) tip.setAttribute(attr, value)
    }

    const update = () => {
      const p = place(
        trigger.getBoundingClientRect(),
        { width: tip.offsetWidth, height: tip.offsetHeight },
        {
          side,
          gap: GAP,
          margin: MARGIN,
          viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
        },
      )
      tip.style.top = `${p.top}px`
      tip.style.left = `${p.left}px`
      tip.dataset.side = p.side
    }
    update()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', hide, true)
    document.addEventListener('keydown', onKey)
    return () => {
      lastHiddenAt = performance.now()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', hide, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [isOpen, trigger, side, hide])

  const own = children.props
  const ref = useMergedRef<HTMLElement>(own.ref, setTrigger)
  const describedBy =
    [own['aria-describedby'], isOpen && describe ? id : undefined].filter(Boolean).join(' ') ||
    undefined
  const triggerElement = cloneElement(children, { ref, 'aria-describedby': describedBy })

  return (
    <>
      {triggerElement}
      {isOpen &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className={cx(styles.floating, styles.bubble)}
            data-motion="opacity"
            onPointerEnter={() => window.clearTimeout(closeTimer.current)}
            onPointerLeave={hideSoon}
          >
            <span className={styles.text}>{content}</span>
            {shortcut && <Kbd keys={shortcut} size="sm" />}
          </div>,
          document.body,
        )}
    </>
  )
}

export interface TooltipBubbleProps extends Omit<ComponentProps<'div'>, 'content'> {
  content: ReactNode
  shortcut?: string
}

/** The tooltip's look without behaviour, for static previews (/design). */
export function TooltipBubble({ content, shortcut, className, ...rest }: TooltipBubbleProps) {
  return (
    <div className={cx(styles.bubble, className)} {...rest}>
      <span className={styles.text}>{content}</span>
      {shortcut && <Kbd keys={shortcut} size="sm" />}
    </div>
  )
}
