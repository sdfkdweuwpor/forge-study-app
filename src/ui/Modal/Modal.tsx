import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { focusInside, getFocusable } from '../Popover/focus'
import { useLayer } from '../Popover/layers'
import { OverlayPortal } from '../Popover/OverlayPortal'
import { usePresence } from '../Popover/usePresence'
import { ModalPanel, type ModalSize } from './ModalPanel'
import { useModalPresence } from './ModalPresence'
import { lockBodyScroll } from './scrollLock'
import styles from './Modal.module.css'

export interface ModalProps {
  open: boolean
  onClose: () => void
  /** Names the dialog (aria-labelledby). Always required, even when `hideTitle` keeps it off screen. */
  title: string
  description?: ReactNode
  /** Actions, right-aligned. Put the primary action last. */
  footer?: ReactNode
  /** sm 400px (confirmations), md 520px (forms), lg 720px. Below 640px every modal is a full-screen sheet. */
  size?: ModalSize
  /** Escape closes. Default true. Turn off while something unsaved or in flight needs a decision. */
  closeOnEsc?: boolean
  /** Clicking the scrim closes. Default true. */
  closeOnScrim?: boolean
  /** Show the title to screen readers only. */
  hideTitle?: boolean
  /** Show the X button. Default true. */
  showClose?: boolean
  children: ReactNode
}

/** Matches the exit animation in Modal.module.css (--dur-2), plus a little slack. */
const EXIT_MS = 220

/**
 * A modal dialog: scrim, focus trap, body scroll lock, `aria-modal`, labelled by its title. Focus
 * moves to the first `[data-autofocus]` element, else the first control in the content, else the
 * close button, and returns to whatever had it when the modal closes. Esc and the scrim close it
 * (each can be turned off). Below 640px it is a full-screen sheet.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'md',
  closeOnEsc = true,
  closeOnScrim = true,
  hideTitle,
  showClose = true,
  children,
}: ModalProps) {
  const mounted = usePresence(open, EXIT_MS)
  // An inline marker: it sits in the caller's tree, so the portal can copy the theme from there.
  const [marker, setMarker] = useState<HTMLElement | null>(null)
  const [panel, setPanel] = useState<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  const isTop = useLayer(open, () => {
    if (closeOnEsc) onClose()
  })
  // The app blocks page shortcuts for as long as a dialog is open.
  useModalPresence(open)

  // Remember what had focus, and give it back on close (unless focus has since moved elsewhere on purpose).
  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      const active = document.activeElement
      const stillHere =
        active === document.body || active === null || panelRef.current?.contains(active)
      if (stillHere && previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    return lockBodyScroll()
  }, [open])

  // Move focus in once the panel exists and has been laid out.
  useEffect(() => {
    if (!open || !panel) return undefined
    const frame = requestAnimationFrame(() => {
      const explicit = panel.querySelector<HTMLElement>('[data-autofocus]')
      const first = getFocusable(panel).find((el) => el !== closeButton.current)
      focusInside(panel, explicit ?? first ?? closeButton.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [open, panel])

  // Keep focus inside while this is the topmost layer (nested menus and toasts are exempt).
  useEffect(() => {
    if (!open || !panel) return undefined
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target
      if (!(target instanceof Node) || panel.contains(target) || !isTop()) return
      if (target instanceof Element && target.closest('[data-focus-trap-ignore]')) return
      focusInside(panel)
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [open, panel, isTop])

  const setPanelRefs = useCallback((el: HTMLDivElement | null) => {
    panelRef.current = el
    setPanel(el)
  }, [])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || e.defaultPrevented) return
    const focusables = getFocusable(e.currentTarget)
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (!first || !last) {
      e.preventDefault()
      e.currentTarget.focus()
    } else if (e.shiftKey && (active === first || active === e.currentTarget)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }, [])

  // A press that starts inside the dialog (selecting text) and ends on the scrim must not close it.
  const pressStartedOnScrim = useRef(false)

  return (
    <>
      <span ref={setMarker} hidden />
      {mounted && (
        <OverlayPortal origin={marker}>
          <div
            className={styles.scrim}
            data-state={open ? 'open' : 'closed'}
            data-motion="opacity"
            role="presentation"
            onPointerDown={(e) => {
              pressStartedOnScrim.current = e.target === e.currentTarget
            }}
            onClick={(e) => {
              const onScrim = e.target === e.currentTarget && pressStartedOnScrim.current
              pressStartedOnScrim.current = false
              if (onScrim && closeOnScrim) onClose()
            }}
          >
            <ModalPanel
              ref={setPanelRefs}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={description != null ? descriptionId : undefined}
              tabIndex={-1}
              data-state={open ? 'open' : 'closed'}
              title={title}
              titleId={titleId}
              descriptionId={descriptionId}
              description={description}
              footer={footer}
              size={size}
              hideTitle={hideTitle}
              onClose={showClose ? onClose : undefined}
              closeRef={(el) => {
                closeButton.current = el
              }}
              onKeyDown={onKeyDown}
            >
              {children}
            </ModalPanel>
          </div>
        </OverlayPortal>
      )}
    </>
  )
}
