import { useId, useState, type ChangeEvent } from 'react'
import { X } from 'lucide-react'
import { toISODate, type WeekStart } from '@/logic/dates'
import { quickDates, type QuickDateId } from './quickDates'
import styles from './DatePicker.module.css'

export type { QuickDateId } from './quickDates'

export interface DatePickerProps {
  /** ISO calendar day `'YYYY-MM-DD'`, or null when empty. */
  value: string | null
  onChange: (value: string | null) => void
  /** Accessible name of the date field, e.g. "Due date". Not rendered visibly. */
  label: string
  /** Adds a `type="time"` input next to the date. */
  withTime?: boolean
  /** `'HH:mm'` (24 hour), or null when empty. Used with `withTime`. */
  time?: string | null
  onTimeChange?: (time: string | null) => void
  /** Accessible name of the time field. Defaults to `"<label>, time"`. */
  timeLabel?: string
  /** Show quick-pick chips: `true` for Today / Tomorrow / Next week, or pick which ones. */
  quickPicks?: boolean | readonly QuickDateId[]
  /** Today as `'YYYY-MM-DD'` for the chips. Defaults to the device date when first rendered. */
  today?: string
  /** "Next week" is the first day of the next week. Monday (1) by default. */
  weekStartsOn?: WeekStart
  min?: string
  max?: string
  /** Show the clear button while a date or time is set. Default true. */
  clearable?: boolean
  disabled?: boolean
  /** Error message; also marks the field invalid. */
  error?: string
  size?: 'sm' | 'md'
  id?: string
  className?: string
}

const ALL_QUICK: readonly QuickDateId[] = ['today', 'tomorrow', 'next-week']

export function DatePicker({
  value,
  onChange,
  label,
  withTime = false,
  time = null,
  onTimeChange,
  timeLabel,
  quickPicks = false,
  today,
  weekStartsOn = 1,
  min,
  max,
  clearable = true,
  disabled = false,
  error,
  size = 'md',
  id,
  className,
}: DatePickerProps) {
  const autoId = useId()
  const dateId = id ?? `${autoId}-date`
  const errorId = `${autoId}-error`
  const [deviceToday] = useState(() => toISODate(new Date()))

  const hasValue = value !== null || (withTime && time !== null)
  const chipIds = quickPicks === true ? ALL_QUICK : quickPicks === false ? [] : quickPicks
  const chips = quickDates(today ?? deviceToday, chipIds, weekStartsOn)

  const handleDate = (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value || null)
  const handleTime = (e: ChangeEvent<HTMLInputElement>) => onTimeChange?.(e.target.value || null)
  const clear = () => {
    onChange(null)
    if (withTime) onTimeChange?.(null)
  }

  return (
    <div className={className ? `${styles.root} ${className}` : styles.root}>
      <div
        className={styles.field}
        data-size={size}
        data-invalid={error ? true : undefined}
        data-disabled={disabled ? true : undefined}
      >
        <input
          id={dateId}
          type="date"
          className={styles.input}
          data-part="date"
          data-empty={value === null ? true : undefined}
          value={value ?? ''}
          onChange={handleDate}
          min={min}
          max={max}
          disabled={disabled}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        {withTime ? (
          <>
            <span className={styles.divider} aria-hidden="true" />
            <input
              type="time"
              className={styles.input}
              data-part="time"
              data-empty={time === null ? true : undefined}
              value={time ?? ''}
              onChange={handleTime}
              disabled={disabled}
              aria-label={timeLabel ?? `${label}, time`}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
          </>
        ) : null}
        {clearable && hasValue && !disabled ? (
          <button type="button" className={styles.clear} onClick={clear} aria-label={`Clear ${label}`}>
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {chips.length > 0 ? (
        <div className={styles.chips} role="group" aria-label={`${label} quick picks`}>
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={styles.chip}
              aria-pressed={value === chip.date}
              disabled={disabled}
              onClick={() => onChange(chip.date)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
