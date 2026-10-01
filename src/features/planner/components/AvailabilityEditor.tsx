import { Copy, Plus, Trash2 } from 'lucide-react'
import type { ISODate } from '@/db/types'
import { newId } from '@/lib/ids'
import { formatHours, plural } from '@/logic/goalDisplay'
import {
  copyDayTo,
  DAY_NAMES,
  defaultShift,
  DEFAULT_WINDOW,
  clampSession,
  setDayWindows,
  shiftDays,
  SHIFT_PRESET_IDS,
  SHIFT_PRESET_LABELS,
  studyDaysPerWeek,
  weeklyWindowMinutes,
  WEEK_ORDER,
  type AvailabilityDraft,
} from '@/logic/plannerAvailability'
import { Button } from '@/ui/Button'
import { DatePicker } from '@/ui/DatePicker'
import { Dropdown, type MenuEntry } from '@/ui/Dropdown'
import { IconButton } from '@/ui/IconButton'
import { Input } from '@/ui/Input'
import { Tag } from '@/ui/Tag'
import { Toggle } from '@/ui/Toggle'
import shared from '../shared.module.css'
import styles from './AvailabilityEditor.module.css'
import { Heading, type HeadingLevel } from './Heading'
import { WindowsList } from './WindowsList'

export interface AvailabilityEditorProps {
  value: AvailabilityDraft
  onChange: (next: AvailabilityDraft) => void
  errors: Readonly<Record<string, string>>
  today: ISODate
  /**
   * Level of the section titles: 2 on the planner's step (under the page's h1), 3 inside a dialog (under
   * its h2 title). Default 2.
   */
  headingLevel?: Extract<HeadingLevel, 2 | 3>
}

/** The "≈ 14 h/week available" line. */
export function AvailabilitySummary({ value }: { value: AvailabilityDraft }) {
  const minutes = weeklyWindowMinutes(value)
  const days = studyDaysPerWeek(value)
  return (
    <p className={styles.summary} aria-live="polite">
      {minutes === 0 ? (
        'No study time yet.'
      ) : (
        <>
          <strong className={shared.num}>≈ {formatHours(minutes)} h/week</strong> available across{' '}
          {days === 1 ? '1 study day' : `${days} study days`}
        </>
      )}
    </p>
  )
}

/**
 * When you can study: windows per weekday (several per day, copy one day to the others), the session
 * length, blackout dates and an optional rotating shift pattern. Used by the planner's third step and by
 * the goal page's Plan settings, so both behave the same.
 */
export function AvailabilityEditor({
  value,
  onChange,
  errors,
  today,
  headingLevel = 2,
}: AvailabilityEditorProps) {
  const shiftOn = value.shift !== null
  const patch = (p: Partial<AvailabilityDraft>) => onChange({ ...value, ...p })

  return (
    <div className={shared.stack}>
      <AvailabilitySummary value={value} />

      <section aria-labelledby="avail-days" className={shared.section}>
        <Heading level={headingLevel} id="avail-days" className={shared.sectionTitle}>
          {shiftOn ? 'Weekly windows (used when no shift applies)' : 'Study days and times'}
        </Heading>
        {shiftOn ? (
          <p className={shared.hint}>
            Your shift pattern below replaces these while it is on. Turn it off to use them.
          </p>
        ) : null}
        <ul className={styles.days} data-muted={shiftOn || undefined}>
          {WEEK_ORDER.map((weekday) => {
            const name = DAY_NAMES[weekday] ?? ''
            const windows = value.weekly[weekday] ?? []
            const on = windows.length > 0
            const items: MenuEntry[] = [
              {
                id: 'weekdays',
                label: 'Copy to Monday to Friday',
                icon: <Copy />,
                onSelect: () => onChange(copyDayTo(value, weekday, 'weekdays')),
              },
              {
                id: 'all',
                label: 'Copy to every day',
                icon: <Copy />,
                onSelect: () => onChange(copyDayTo(value, weekday, 'all')),
              },
            ]
            const windowErrors: Record<number, string | undefined> = {}
            windows.forEach((_, i) => {
              windowErrors[i] = errors[`window:${weekday}:${i}`]
            })
            return (
              <li key={weekday} className={styles.day}>
                <div className={styles.dayHead}>
                  <Toggle
                    size="sm"
                    label={name}
                    checked={on}
                    onCheckedChange={(next) =>
                      onChange(setDayWindows(value, weekday, next ? [{ ...DEFAULT_WINDOW }] : []))
                    }
                  />
                </div>
                <div className={styles.dayBody}>
                  {on ? (
                    <WindowsList
                      name={name}
                      windows={windows}
                      errors={windowErrors}
                      onChange={(ws) => onChange(setDayWindows(value, weekday, ws))}
                      addLabel={`Add a window on ${name}`}
                      inlineAdd
                    />
                  ) : (
                    <span className={styles.off}>No study</span>
                  )}
                </div>
                <div className={styles.dayMenu}>
                  {on ? (
                    <Dropdown
                      label={`${name} actions`}
                      align="end"
                      items={items}
                      trigger={(p) => (
                        <Button {...p} variant="ghost" size="sm" iconLeft={<Copy />}>
                          Copy
                        </Button>
                      )}
                    />
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
        {errors.days ? (
          <p className={shared.error} role="alert">
            {errors.days}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="avail-session" className={shared.section}>
        <Heading level={headingLevel} id="avail-session" className={shared.sectionTitle}>
          Session length
        </Heading>
        <div className={styles.slider}>
          <input
            type="range"
            aria-label="Session length in minutes"
            min={25}
            max={90}
            step={5}
            value={clampSession(value.sessionMinutes)}
            onChange={(e) => patch({ sessionMinutes: Number(e.target.value) })}
          />
          <output className={shared.num}>{clampSession(value.sessionMinutes)} min</output>
        </div>
        <p className={shared.hint}>
          Forge cuts study into sessions this long, with a short break between them.
        </p>
      </section>

      <section aria-labelledby="avail-off" className={shared.section}>
        <Heading level={headingLevel} id="avail-off" className={shared.sectionTitle}>
          Days off and vacations
        </Heading>
        {value.blackouts.length > 0 ? (
          <ul className={styles.ranges}>
            {value.blackouts.map((b, i) => (
              <li key={b.key} className={styles.range}>
                <DatePicker
                  size="sm"
                  label={`Days off ${i + 1}, first day`}
                  value={b.start || null}
                  today={today}
                  clearable={false}
                  onChange={(v) =>
                    patch({
                      blackouts: value.blackouts.map((x) =>
                        x.key === b.key
                          ? { ...x, start: v ?? '', ...(x.end === '' && v ? { end: v } : {}) }
                          : x,
                      ),
                    })
                  }
                />
                <span className={styles.to} aria-hidden="true">
                  to
                </span>
                <DatePicker
                  size="sm"
                  label={`Days off ${i + 1}, last day`}
                  value={b.end || null}
                  today={today}
                  clearable={false}
                  min={b.start || undefined}
                  onChange={(v) =>
                    patch({
                      blackouts: value.blackouts.map((x) =>
                        x.key === b.key ? { ...x, end: v ?? '' } : x,
                      ),
                    })
                  }
                />
                <Input
                  size="sm"
                  aria-label={`Days off ${i + 1}, label`}
                  placeholder="Label (optional)"
                  value={b.label}
                  maxLength={60}
                  className={styles.rangeLabel}
                  onChange={(e) =>
                    patch({
                      blackouts: value.blackouts.map((x) =>
                        x.key === b.key ? { ...x, label: e.target.value } : x,
                      ),
                    })
                  }
                />
                <IconButton
                  size="sm"
                  label={`Remove days off ${i + 1}`}
                  icon={<Trash2 />}
                  onClick={() =>
                    patch({ blackouts: value.blackouts.filter((x) => x.key !== b.key) })
                  }
                />
                {errors[`blackout:${b.key}`] ? (
                  <p className={shared.error} role="alert">
                    {errors[`blackout:${b.key}`]}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={shared.hint}>Nothing blocked out. Add a vacation, exam week or trip.</p>
        )}
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<Plus />}
          className={styles.addRange}
          onClick={() =>
            patch({
              blackouts: [...value.blackouts, { key: newId(), start: '', end: '', label: '' }],
            })
          }
        >
          Add days off
        </Button>
      </section>

      <section aria-labelledby="avail-shift" className={shared.section}>
        <div className={styles.shiftHead}>
          <Heading level={headingLevel} id="avail-shift" className={shared.sectionTitle}>
            Rotating shifts
          </Heading>
          <Toggle
            size="sm"
            label="I work a rotating shift"
            checked={shiftOn}
            onCheckedChange={(on) => patch({ shift: on ? defaultShift(today) : null })}
          />
        </div>
        {value.shift ? (
          <ShiftEditor value={value} onChange={onChange} errors={errors} today={today} />
        ) : (
          <p className={shared.hint}>
            Study time follows a cycle instead of the week: for example 3 days on, 4 days off.
          </p>
        )}
      </section>
    </div>
  )
}

function ShiftEditor({ value, onChange, errors, today }: AvailabilityEditorProps) {
  const shift = value.shift
  if (!shift) return null
  const setShift = (p: Partial<typeof shift>) => onChange({ ...value, shift: { ...shift, ...p } })
  const days = shiftDays(shift.preset)
  const on = days.filter(Boolean).length
  const winErrors = (kind: 'on' | 'off', n: number): Record<number, string | undefined> => {
    const out: Record<number, string | undefined> = {}
    for (let i = 0; i < n; i++) out[i] = errors[`shift:${kind}:${i}`]
    return out
  }
  return (
    <div className={styles.shift}>
      <div className={styles.presets} role="group" aria-label="Shift pattern">
        {SHIFT_PRESET_IDS.map((id) => (
          <Tag
            key={id}
            shape="pill"
            pressed={shift.preset === id}
            onClick={() => setShift({ preset: id })}
          >
            {SHIFT_PRESET_LABELS[id]}
          </Tag>
        ))}
      </div>
      <div className={styles.cycle} aria-hidden="true">
        {days.map((isOn, i) => (
          <span key={i} className={styles.cycleDay} data-on={isOn || undefined} />
        ))}
      </div>
      <p className={shared.hint}>
        {plural(on, 'work day')} then {plural(days.length - on, 'day')} off, repeating every{' '}
        {days.length} days. Filled squares are work days.
      </p>
      <div className={shared.field}>
        <span className={shared.fieldLabel}>First work day of a cycle</span>
        <DatePicker
          size="sm"
          label="First work day of a cycle"
          value={shift.anchor}
          today={today}
          clearable={false}
          error={errors.anchor}
          onChange={(v) => v && setShift({ anchor: v })}
        />
      </div>
      <div className={shared.field}>
        <span className={shared.fieldLabel}>Study windows on work days</span>
        <WindowsList
          name="Work day"
          windows={shift.onWindows}
          errors={winErrors('on', shift.onWindows.length)}
          onChange={(ws) => setShift({ onWindows: ws })}
          addLabel="Add window"
          empty="No study on work days."
        />
      </div>
      <div className={shared.field}>
        <span className={shared.fieldLabel}>Study windows on days off</span>
        <WindowsList
          name="Day off"
          windows={shift.offWindows}
          errors={winErrors('off', shift.offWindows.length)}
          onChange={(ws) => setShift({ offWindows: ws })}
          addLabel="Add window"
          empty="No study on days off."
        />
      </div>
    </div>
  )
}
