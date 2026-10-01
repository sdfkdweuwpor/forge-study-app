/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex --
   ARIA window-splitter pattern: a focusable `separator` that resizes with pointer drag or arrow keys. */
import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import styles from './Shell.module.css'

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 400
export const SIDEBAR_DEFAULT = 240
const KEY_STEP = 16

export const clampWidth = (px: number) =>
  Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, px)))

/** A press that moves this far or less is a click, not a resize. */
const DRAG_THRESHOLD_PX = 2

interface ResizerProps {
  width: number
  dragging: boolean
  onDragStart(): void
  /** Live width while dragging (not persisted). */
  onDrag(px: number): void
  /** Final width: persist it. Not called for a click, a right-click or a cancelled drag. */
  onCommit(px: number): void
  /** The gesture is over, however it ended. */
  onDragEnd(): void
}

interface DragState {
  startX: number
  startWidth: number
  moved: boolean
}

/** Drag handle on the sidebar's right edge. Arrow keys nudge (Shift = bigger), Home/End jump, double-click resets. */
export function Resizer({
  width,
  dragging,
  onDragStart,
  onDrag,
  onCommit,
  onDragEnd,
}: ResizerProps) {
  const drag = useRef<DragState | null>(null)

  const down = (e: PointerEvent<HTMLDivElement>) => {
    // Primary button of the primary pointer only: not right/middle click, not a second finger.
    if (e.button !== 0 || !e.isPrimary) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startWidth: width, moved: false }
    onDragStart()
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.abs(e.clientX - d.startX) <= DRAG_THRESHOLD_PX) return
    d.moved = true
    onDrag(clampWidth(e.clientX))
  }
  const finish = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (d.moved && !cancelled) onCommit(clampWidth(e.clientX))
    else if (d.moved) onDrag(d.startWidth)
    onDragEnd()
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP
    if (e.key === 'ArrowLeft') onCommit(clampWidth(width - step))
    else if (e.key === 'ArrowRight') onCommit(clampWidth(width + step))
    else if (e.key === 'Home') onCommit(SIDEBAR_MIN)
    else if (e.key === 'End') onCommit(SIDEBAR_MAX)
    else return
    e.preventDefault()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      tabIndex={0}
      className={styles.resizer}
      data-active={dragging || undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onKeyDown={key}
      onDoubleClick={() => onCommit(SIDEBAR_DEFAULT)}
    />
  )
}
