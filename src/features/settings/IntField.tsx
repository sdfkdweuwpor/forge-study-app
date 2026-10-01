import { useState, type KeyboardEvent } from 'react'
import { Input } from '@/ui/Input'
import styles from './IntField.module.css'

interface IntFieldProps {
  /** The saved number. */
  value: number
  min: number
  max: number
  /** Shown inside the field on the right ("min"). */
  unit?: string
  /** The id of the element that names this field. */
  labelledBy: string
  /** Called with a valid whole number, on Enter or when the field loses focus. */
  onCommit: (value: number) => void
}

/**
 * A whole number as text, saved on Enter or blur: a number typed digit by digit ("2", then "25") never
 * writes the half-typed value, and a value out of range is explained instead of being clamped silently.
 * Escape puts the saved number back.
 */
export function IntField({ value, min, max, unit, labelledBy, onCommit }: IntFieldProps) {
  const shown = String(value)
  const [text, setText] = useState(shown)
  const [seen, setSeen] = useState(shown)
  const [bad, setBad] = useState(false)
  // Follow the saved value when it changes from elsewhere (an import, another tab).
  if (shown !== seen) {
    setSeen(shown)
    setText(shown)
    setBad(false)
  }

  function commit() {
    const t = text.trim()
    if (t === '') {
      setText(shown)
      setBad(false)
      return
    }
    const n = /^\d{1,4}$/.test(t) ? Number(t) : Number.NaN
    if (!Number.isInteger(n) || n < min || n > max) {
      setBad(true)
      return
    }
    setBad(false)
    setText(String(n))
    if (n !== value) onCommit(n)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape' && (bad || text !== shown)) {
      e.preventDefault()
      e.stopPropagation()
      setText(shown)
      setBad(false)
    }
  }

  return (
    <Input
      className={styles.field}
      size="sm"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      aria-labelledby={labelledBy}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      trailing={unit ? <span className={styles.unit}>{unit}</span> : undefined}
      error={bad ? `Not saved. Use a whole number from ${min} to ${max}.` : undefined}
    />
  )
}
