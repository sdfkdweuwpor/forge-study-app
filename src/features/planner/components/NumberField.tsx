import { useState, type KeyboardEvent } from 'react'
import { parseDecimalInput } from '@/logic/plannerEffort'
import { Input } from '@/ui/Input'
import shared from '../shared.module.css'

export interface NumberFieldProps {
  /** The committed number, or `null` when the field is empty. */
  value: number | null
  /** Called with a valid number on blur or Enter; with `null` for an empty field when `nullable`. */
  onCommit: (value: number | null) => void
  label: string
  unit: string
  /** Exclusive lower bound (a multiplier of 0 is not a multiplier). */
  above: number
  max: number
  /** An empty field means "no value". Otherwise it goes back to the committed number. */
  nullable?: boolean
  /** Shown when the text is not a number in range. */
  invalidText: string
  placeholder?: string
  className?: string
}

/**
 * A decimal as text, committed on Enter or blur (the same pattern as `HoursField`): "12." must not snap
 * back to "12", the field can be emptied while typing, and "0.5" can be typed on the way through "0".
 */
export function NumberField({
  value,
  onCommit,
  label,
  unit,
  above,
  max,
  nullable = false,
  invalidText,
  placeholder,
  className,
}: NumberFieldProps) {
  const shown = value === null ? '' : String(value)
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
    if (text.trim() === '') {
      setBad(false)
      if (nullable) {
        if (value !== null) onCommit(null)
      } else setText(shown)
      return
    }
    const n = parseDecimalInput(text)
    if (n === null || n <= above || n > max) {
      setBad(true)
      return
    }
    setBad(false)
    setText(String(n))
    if (n !== value) onCommit(n)
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
      value={text}
      placeholder={placeholder}
      error={bad ? invalidText : undefined}
      trailing={<span className={shared.unit}>{unit}</span>}
      className={className ?? shared.hours}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  )
}
