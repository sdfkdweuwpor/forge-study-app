import { useRef, useState, type CSSProperties } from 'react'
import styles from './Slider.module.css'

export interface SliderProps {
  /** The stored value, 0..1. While the person drags, the slider shows their value instead. */
  value: number
  /** Fires on every movement, while dragging or stepping with the keyboard (drive a live preview here). */
  onValueChange?: (value: number) => void
  /**
   * Fires once when the person lets go (or pauses on a key), with the final value. Save here. If it
   * returns a promise that rejects, the slider goes back to the stored value.
   */
  onValueCommit?: (value: number) => void | Promise<void>
  /** Accessible name, e.g. "Chime volume". */
  label: string
  disabled?: boolean
  className?: string
}

const STEP = 5

/** A value the person dragged to, and the stored value it was dragged from. */
interface Draft {
  value: number
  base: number
}

/**
 * A volume slider: a native `<input type="range">` (so touch, keyboard, Home/End and screen readers
 * work for free), drawn with the app's tokens. The fill is one CSS variable. Steps of 5%, with the
 * value shown as a percentage.
 *
 * The draft is only used while the stored value still equals the one it started from, so when the
 * save lands the slider switches back to the stored value without a frame of the old one.
 */
export function Slider({
  value,
  onValueChange,
  onValueCommit,
  label,
  disabled = false,
  className,
}: SliderProps) {
  const stored = toPercent(value)
  const [draft, setDraft] = useState<Draft | null>(null)
  const pending = useRef<number | null>(null)
  const shown = draft && draft.base === stored ? draft.value : stored

  const commit = () => {
    const v = pending.current
    pending.current = null
    if (v === null) return
    Promise.resolve(onValueCommit?.(v / 100)).catch(() => setDraft(null))
  }

  return (
    <span className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <input
        type="range"
        className={styles.range}
        min={0}
        max={100}
        step={STEP}
        value={shown}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={`${shown}%`}
        style={{ '--_fill': `${shown}%` } as CSSProperties}
        onChange={(e) => {
          const v = Number(e.currentTarget.value)
          setDraft({ value: v, base: stored })
          pending.current = v
          onValueChange?.(v / 100)
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className={styles.value} aria-hidden="true">
        {shown}%
      </span>
    </span>
  )
}

function toPercent(v: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
  return Math.round((clamped * 100) / STEP) * STEP
}
