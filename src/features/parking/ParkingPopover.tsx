import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRestoreFocus } from '@/app/hooks/useRestoreFocus'
import { useOpenOverlays } from '@/app/providers/OverlayProvider'
import { recordError } from '@/app/reportError'
import { useShortcutScope } from '@/app/shortcuts'
import { addParkingItem, cleanParkingText, PARKING_TEXT_MAX } from '@/db/repos/parking'
import type { ID } from '@/db/types'
import { Input } from '@/ui/Input'
import { useToast } from '@/ui/Toast'
import styles from './ParkingPopover.module.css'

/**
 * Full-screen focus holds keyboard focus inside its own view (a focus that lands outside is pulled
 * back), so while it is open the popover is drawn inside it. Found by its role and name: the view is
 * the focus feature's, and this feature only reads it.
 */
export function fullscreenView(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"][aria-label="Focus mode"]')
}

interface ParkingPopoverProps {
  /** The focus session it is parked in when it opens (`null` when none runs). */
  sessionId: ID | null
  onClose: () => void
  /** A thought was saved. `host` is where the popover was drawn, so a confirmation can go there. */
  onParked: (host: HTMLElement) => void
}

/**
 * The tiny "Thought or urge? Park it here." input. Enter saves and closes; Esc closes without saving;
 * leaving the box (a click elsewhere, the session ending) saves what was typed, because a thought that
 * was worth typing is worth keeping. Keyboard focus goes back to where it was. Mounted only while open,
 * so every opening starts empty.
 */
export function ParkingPopover({ sessionId, onClose, onParked }: ParkingPopoverProps) {
  useShortcutScope('menu')
  useRestoreFocus()
  const toast = useToast()
  const fullscreenOpen = useOpenOverlays().includes('focusFullscreen')
  // Where it is drawn, and which session it belongs to, are decided once, when it opens.
  const [host] = useState<HTMLElement>(() => fullscreenView() ?? document.body)
  const [session] = useState(sessionId)
  const inFullscreen = host !== document.body

  const [text, setText] = useState('')
  const textNow = useRef('')
  const settled = useRef(false)
  const armed = useRef(false)
  const input = useRef<HTMLInputElement | null>(null)

  /** Saves what is typed, once. Starts the write before anything closes, so closing never cancels it. */
  const park = (): void => {
    const clean = cleanParkingText(textNow.current)
    // A blank box parks nothing and stays unsettled: a StrictMode remount must not count as leaving.
    if (settled.current || clean === '') return
    settled.current = true
    addParkingItem({ text: clean, sessionId: session }).then(
      () => onParked(host),
      (error: unknown) => {
        recordError(error, 'park a thought')
        toast.error('Couldn’t park that', { description: 'Nothing was saved. Try again.' })
      },
    )
  }

  // Focus at once so the first keystrokes land in the box, and again once everything else has settled
  // (a palette that just closed restores focus in its own effect). Only then does leaving it count.
  useEffect(() => {
    input.current?.focus({ preventScroll: true })
    const frame = requestAnimationFrame(() => {
      if (document.activeElement !== input.current) input.current?.focus({ preventScroll: true })
      armed.current = true
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  // Whatever removes it (a click elsewhere, a route change), a thought that was typed is kept.
  const latest = useRef({ park, onClose })
  useEffect(() => {
    latest.current = { park, onClose }
  })
  useEffect(() => {
    const ref = latest
    return () => ref.current.park()
  }, [])

  // Leaving full screen with the browser's own Esc removes the view this is drawn in.
  useEffect(() => {
    if (inFullscreen && !fullscreenOpen) latest.current.onClose()
  }, [inFullscreen, fullscreenOpen])

  return createPortal(
    <div className={styles.layer} data-in-fullscreen={inFullscreen || undefined}>
      <div
        className={styles.panel}
        role="dialog"
        aria-label="Park a thought"
        data-motion="opacity"
        data-testid="parking-popover"
      >
        <form
          onSubmit={(e) => {
            // Enter: park it and close.
            e.preventDefault()
            park()
            onClose()
          }}
        >
          <Input
            ref={input}
            label="Thought or urge? Park it here."
            hint="Enter to park it, Esc to close. It’ll be here after your session."
            placeholder="e.g. check the C182 exam dates"
            value={text}
            maxLength={PARKING_TEXT_MAX}
            autoComplete="off"
            enterKeyHint="done"
            onChange={(e) => {
              textNow.current = e.target.value
              setText(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              // Esc closes this and nothing else (not the full-screen view behind it), and saves nothing.
              e.preventDefault()
              settled.current = true
              onClose()
            }}
            onBlur={() => {
              // A click elsewhere: keep what was typed, and get out of the way.
              if (!armed.current) return
              park()
              onClose()
            }}
          />
        </form>
      </div>
    </div>,
    host,
  )
}
