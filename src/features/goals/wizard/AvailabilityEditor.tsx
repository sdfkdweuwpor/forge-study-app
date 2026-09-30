import { Plus, Trash2 } from 'lucide-react'
import { useState, type Dispatch, type KeyboardEvent } from 'react'
import { newId } from '@/lib/ids'
import type { ISODate } from '@/db/types'
import { formatHours, plural } from '@/logic/goalDisplay'
import {
  DAY_MAX_MINUTES,
  DEFAULT_DAY_MINUTES,
  WEEKDAY_NAMES,
  WEEKDAY_ORDER,
  weekSummary,
  type DraftErrors,
  type DraftGoal,
} from '@/logic/goalDraft'
import type { WizardAction } from '@/logic/goalWizard'
import { Button } from '@/ui/Button'
import { DatePicker } from '@/ui/DatePicker'
import { IconButton } from '@/ui/IconButton'
import { Input } from '@/ui/Input'
import { Toggle } from '@/ui/Toggle'
import styles from './wizard.module.css'

/** Hours as text, committed on Enter or blur: typing "1." or "" must not fight the number underneath. */
function HoursInput({
  minutes,
  disabled,
  label,
  onCommit,
}: {
  minutes: number
  disabled: boolean
  label: string
  onCommit: (minutes: number) => void
}) {
  const shown = minutes === 0 ? '' : formatHours(minutes)
  const [text, setText] = useState(shown)
  const [seen, setSeen] = useState(shown)
  // Follow the value when it changes from outside (the day toggled on), unless it is being typed.
  if (shown !== seen) {
    setSeen(shown)
    setText(shown)
  }

  function commit() {
    const n = Number(text.trim().replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) {
      setText(shown)
      return
    }
    const next = Math.min(DAY_MAX_MINUTES, Math.round((n * 60) / 5) * 5)
    setText(formatHours(next))
    if (next !== minutes) onCommit(next)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      // Commits this field only; the wizard's own Enter handling must not also move on.
      e.preventDefault()
      e.stopPropagation()
      commit()
    }
  }

  return (
    <Input
      size="sm"
      aria-label={label}
      inputMode="decimal"
      value={disabled ? '' : text}
      placeholder={disabled ? 'Off' : '1'}
      disabled={disabled}
      trailing={<span className={styles.unit}>h</span>}
      className={styles.hours}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  )
}

export interface AvailabilityEditorProps {
  draft: DraftGoal
  dispatch: Dispatch<WizardAction>
  errors: DraftErrors
  today: ISODate
}

/**
 * Study days and hours per weekday (each weekday can differ), days off as date ranges, and an optional
 * six-month WGU term. Used by the new-goal flow and by the goal page's schedule settings.
 */
export function AvailabilityEditor({ draft, dispatch, errors, today }: AvailabilityEditorProps) {
  const { minutesByWeekday: minutes, daysOff, term } = draft
  const summary = weekSummary(minutes)
  // Turning a day back on returns to the hours it last had, or a sensible hour.
  const [lastOn, setLastOn] = useState<Record<number, number>>({})

  return (
    <div className={styles.availability}>
      <section aria-labelledby="study-days-heading" className={styles.section}>
        <h3 id="study-days-heading" className={styles.sectionTitle}>
          Study days
        </h3>
        <ul className={styles.days}>
          {WEEKDAY_ORDER.map((weekday) => {
            const value = minutes[weekday] ?? 0
            const name = WEEKDAY_NAMES[weekday]
            return (
              <li key={weekday} className={styles.day} data-off={value === 0 || undefined}>
                <Toggle
                  size="sm"
                  label={name}
                  checked={value > 0}
                  onCheckedChange={(on) => {
                    if (on) {
                      dispatch({
                        type: 'setDayMinutes',
                        weekday,
                        minutes: lastOn[weekday] ?? DEFAULT_DAY_MINUTES,
                      })
                    } else {
                      setLastOn((prev) => ({ ...prev, [weekday]: value }))
                      dispatch({ type: 'setDayMinutes', weekday, minutes: 0 })
                    }
                  }}
                />
                <HoursInput
                  label={`Hours on ${name}`}
                  minutes={value}
                  disabled={value === 0}
                  onCommit={(m) => dispatch({ type: 'setDayMinutes', weekday, minutes: m })}
                />
              </li>
            )
          })}
        </ul>
        <p className={styles.hint} aria-live="polite">
          {summary.days === 0
            ? 'No study days yet.'
            : `${plural(summary.days, 'study day')} · ${formatHours(summary.minutes)} h a week`}
        </p>
        {errors.days ? (
          <p className={styles.error} role="alert">
            {errors.days}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="days-off-heading" className={styles.section}>
        <h3 id="days-off-heading" className={styles.sectionTitle}>
          Days off and vacations
        </h3>
        {daysOff.length > 0 ? (
          <ul className={styles.ranges}>
            {daysOff.map((range, i) => (
              <li key={range.key} className={styles.range}>
                <DatePicker
                  size="sm"
                  label={`Days off ${i + 1}, first day`}
                  value={range.start || null}
                  today={today}
                  clearable={false}
                  onChange={(v) =>
                    dispatch({
                      type: 'patchRange',
                      key: range.key,
                      // Picking a start with no end yet makes it a single day off.
                      patch: { start: v ?? '', ...(range.end === '' && v ? { end: v } : {}) },
                    })
                  }
                />
                <span className={styles.to} aria-hidden="true">
                  to
                </span>
                <DatePicker
                  size="sm"
                  label={`Days off ${i + 1}, last day`}
                  value={range.end || null}
                  today={today}
                  clearable={false}
                  min={range.start || undefined}
                  onChange={(v) =>
                    dispatch({ type: 'patchRange', key: range.key, patch: { end: v ?? '' } })
                  }
                />
                <Input
                  size="sm"
                  aria-label={`Days off ${i + 1}, label`}
                  placeholder="Label (optional)"
                  value={range.label}
                  maxLength={60}
                  className={styles.rangeLabel}
                  onChange={(e) =>
                    dispatch({
                      type: 'patchRange',
                      key: range.key,
                      patch: { label: e.target.value },
                    })
                  }
                />
                <IconButton
                  size="sm"
                  label={`Remove days off ${i + 1}`}
                  icon={<Trash2 />}
                  onClick={() => dispatch({ type: 'removeRange', key: range.key })}
                />
                {errors[`range:${range.key}`] ? (
                  <p className={styles.error} role="alert">
                    {errors[`range:${range.key}`]}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.hint}>
            Trips, exam weeks, holidays. No study is scheduled on these days.
          </p>
        )}
        <Button
          size="sm"
          variant="ghost"
          iconLeft={<Plus />}
          className={styles.addRange}
          onClick={() => dispatch({ type: 'addRange', key: newId() })}
        >
          Add days off
        </Button>
      </section>

      <section aria-labelledby="term-heading" className={styles.section}>
        <div className={styles.termHead}>
          <h3 id="term-heading" className={styles.sectionTitle}>
            WGU term
          </h3>
          <Toggle
            size="sm"
            aria-label="Track a WGU term"
            checked={term.enabled}
            onCheckedChange={(enabled) => dispatch({ type: 'setTermEnabled', enabled })}
          />
        </div>
        {term.enabled ? (
          <div className={styles.term}>
            <Input
              size="sm"
              label="Term name"
              value={term.label}
              maxLength={40}
              onChange={(e) => dispatch({ type: 'setTermLabel', label: e.target.value })}
            />
            <div className={styles.termDate}>
              <span className={styles.fieldLabel}>Starts</span>
              <DatePicker
                size="sm"
                label="Term start"
                value={term.start}
                today={today}
                clearable={false}
                onChange={(v) => v && dispatch({ type: 'setTermStart', start: v })}
              />
            </div>
            <div className={styles.termDate}>
              <span className={styles.fieldLabel}>Ends</span>
              <DatePicker
                size="sm"
                label="Term end"
                value={term.end}
                today={today}
                clearable={false}
                min={term.start}
                onChange={(v) => v && dispatch({ type: 'setTermEnd', end: v })}
              />
            </div>
          </div>
        ) : (
          <p className={styles.hint}>
            Six-month terms with a “CUs completed this term” bar on the goal page.
          </p>
        )}
        {term.enabled ? (
          <p className={styles.hint}>
            A term runs six months. The end follows the start until you change it.
          </p>
        ) : null}
        {errors.term ? (
          <p className={styles.error} role="alert">
            {errors.term}
          </p>
        ) : null}
      </section>
    </div>
  )
}
