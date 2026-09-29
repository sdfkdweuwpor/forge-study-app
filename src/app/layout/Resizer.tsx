/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex --
   ARIA window-splitter pattern: a focusable `separator` that resizes with pointer drag or arrow keys. */
import type { KeyboardEvent, PointerEvent } from 'react'
import styles from './Shell.module.css'

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 400
export const SIDEBAR_DEFAULT = 240
const KEY_STEP = 16

export const clampWidth = (px: number) =>
  Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, px)))

interface ResizerProps {
  width: number
  dragging: boolean
  onDragStart(): void
  /** Live width while dragging (not persisted). */
  onDrag(px: number): void
  /** Final width: persist it. */
  onCommit(px: number): void
}

/** Drag handle on the sidebar's right edge. Arrow keys nudge (Shift = bigger), Home/End jump, double-click resets. */
export function Resizer({ width, dragging, onDragStart, onDrag, onCommit }: ResizerProps) {
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    onDragStart()
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) onDrag(clampWidth(e.clientX))
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    onCommit(clampWidth(e.clientX))
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
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onDoubleClick={() => onCommit(SIDEBAR_DEFAULT)}
    />
  )
}
