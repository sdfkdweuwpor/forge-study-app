import { useState, type KeyboardEvent } from 'react'
import { effortLabel, parseHoursInput } from '@/logic/plannerEffort'
import { Input } from '@/ui/Input'
import styles from '../shared.module.css'

/** Minutes as hours text ("1.5"), whole numbers without a decimal. */
export function hoursText(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return ''
  return String(Math.round((minutes / 60) * 100) / 100)
}

export interface HoursFieldProps {
  /** Minutes, or `null` when empty. */
  minutes: number | null
  onCommit: (minutes: number | null) => void
  label: string
  placeholder?: string
  error?: string
  disabled?: boolean
  className?: string
}

/**
 * Hours as text, committed on Enter or blur: typing "1." or "" must not fight the number underneath.
 * Accepts "1.5", "90m", "1h30". An empty field means "no estimate of its own".
 */
export function HoursField({
  minutes,
  onCommit,
  label,
  placeholder,
  error,
  disabled,
  className,
}: HoursFieldProps) {
  const shown = hoursText(minutes)
  const [text, setText] = useState(shown)
  const [seen, setSeen] = useState(shown)
  const [bad, setBad] = useState(false)
  // Follow the value when it changes from outside (undo, a template), unless it is being typed.
  if (shown !== seen) {
    setSeen(shown)
    setText(shown)
    setBad(false)
  }

  function commit() {
    const trimmed = text.trim()
    if (trimmed === '') {
      setBad(false)
      if (minutes !== null) onCommit(null)
      return
    }
    const m = parseHoursInput(trimmed)
    if (m === null || m <= 0 || m > 2000 * 60) {
      setBad(true)
      return
    }
    setBad(false)
    setText(hoursText(m))
    if (m !== minutes) onCommit(m)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      commit()
    }
  }

  return (
    <Input
      size="sm"
      aria-label={label}
      inputMode="decimal"
      value={disabled ? '' : text}
      placeholder={placeholder}
      disabled={disabled}
      error={error ?? (bad ? 'Try 1.5 or 90m' : undefined)}
      trailing={<span className={styles.unit}>h</span>}
      className={className ?? styles.hours}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  )
}

export { effortLabel }
