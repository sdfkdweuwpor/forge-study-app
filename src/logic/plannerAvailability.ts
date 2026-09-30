/**
 * The availability part of the planner's draft (pure): study windows per weekday, a session length,
 * blackout ranges and an optional rotating shift pattern. The planner screens edit this shape; the goal
 * stores it as `Goal.planning` + `Goal.availability`, and the planner reads it as `AvailabilityV2`.
 *
 * Windows are `'HH:mm'` wall-clock spans on one day. Index 0 = Sunday, like everywhere else.
 */
import type { Availability, DateRange, Goal, GoalPlanning, HHmm, ISODate, TimeWindow } from '@/db/types'
import { compareISODate, isISODate } from './dates'
import { minutesFromWeekly } from './goalPlanning'
import {
  addMinutesToWindows,
  DEFAULT_SESSION_MINUTES,
  formatClock,
  MAX_SESSION_MINUTES,
  MIN_SESSION_MINUTES,
  parseClock,
  SHIFT_PRESETS,
  shiftCycle,
  windowsToIntervals,
  intervalsToWindows,
  type ShiftPresetId,
} from './scheduler/windows'
import type { AvailabilityV2, DayWindows, ShiftPattern, WeekWindows } from './scheduler/plannerTypes'

export interface DraftBlackout {
  key: string
  /** `''` until picked. */
  start: ISODate | ''
  end: ISODate | ''
  label: string
}

/**
 * A rotating shift: `preset` is the run pattern (work days first), `anchor` is the first work day of a
 * cycle, `onWindows` are the study windows on work days (often a short evening, or none) and
 * `offWindows` those on days off.
 */
export interface ShiftDraft {
  preset: ShiftPresetId
  anchor: ISODate
  onWindows: TimeWindow[]
  offWindows: TimeWindow[]
}

export interface AvailabilityDraft {
  /** 7 entries, Sunday first. */
  weekly: TimeWindow[][]
  sessionMinutes: number
  blackouts: DraftBlackout[]
  shift: ShiftDraft | null
}

export const SHIFT_PRESET_LABELS: Readonly<Record<ShiftPresetId, string>> = {
  '3on4off': '3 on, 4 off',
  '4on3off': '4 on, 3 off',
  '4on4off': '4 on, 4 off',
  '5on2off': '5 on, 2 off',
  '2-2-3': '2-2-3',
}

export const SHIFT_PRESET_IDS = Object.keys(SHIFT_PRESETS) as ShiftPresetId[]

/** Monday first, the order the availability step lists the days in. Values are 0 = Sunday … 6. */
export const WEEK_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0]
export const DAY_NAMES: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]
export const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5]

export const DEFAULT_WINDOW: TimeWindow = { start: '18:00', end: '20:00' }

const win = (start: HHmm, end: HHmm): TimeWindow => ({ start, end })

/** Evenings Monday to Friday and a Saturday morning: a reasonable place to start editing from. */
export function defaultWeekly(): TimeWindow[][] {
  return [[], ...WEEKDAYS.map(() => [win('18:00', '20:00')]), [win('09:00', '12:00')]]
}

export function defaultAvailability(): AvailabilityDraft {
  return {
    weekly: defaultWeekly(),
    sessionMinutes: DEFAULT_SESSION_MINUTES,
    blackouts: [],
    shift: null,
  }
}

const copyWindows = (ws: readonly TimeWindow[]): TimeWindow[] =>
  ws.map((w) => ({ start: w.start, end: w.end }))

export function cloneAvailability(av: AvailabilityDraft): AvailabilityDraft {
  return {
    weekly: av.weekly.map(copyWindows),
    sessionMinutes: av.sessionMinutes,
    blackouts: av.blackouts.map((b) => ({ ...b })),
    shift: av.shift
      ? {
          ...av.shift,
          onWindows: copyWindows(av.shift.onWindows),
          offWindows: copyWindows(av.shift.offWindows),
        }
      : null,
  }
}

// ─── Editing windows ────────────────────────────────────────────────────────

/** What is wrong with a window, in a few words; `null` when it is fine. */
export function windowProblem(w: TimeWindow): string | null {
  const a = parseClock(w.start)
  const b = parseClock(w.end)
  if (a === null || b === null) return 'Pick a start and an end time.'
  if (b <= a) return 'The end must be after the start.'
  if (b - a < MIN_SESSION_MINUTES) return `At least ${MIN_SESSION_MINUTES} minutes.`
  return null
}

/**
 * The window that follows `windows` when "Add window" is pressed: an hour or two after the last one
 * ends (or the default evening for an empty day), kept inside the day.
 */
export function nextWindow(windows: readonly TimeWindow[]): TimeWindow {
  const last = windows[windows.length - 1]
  if (!last) return { ...DEFAULT_WINDOW }
  const end = parseClock(last.end) ?? 20 * 60
  const start = Math.min(end + 60, 22 * 60)
  return { start: formatClock(start), end: formatClock(Math.min(start + 60, 24 * 60)) }
}

/** Windows sorted and merged, empty and malformed ones dropped (what is stored and planned). */
export function cleanWindows(ws: readonly TimeWindow[]): TimeWindow[] {
  return intervalsToWindows(windowsToIntervals(ws))
}

/** Sets one weekday's windows. */
export function setDayWindows(
  av: AvailabilityDraft,
  weekday: number,
  windows: readonly TimeWindow[],
): AvailabilityDraft {
  const weekly = av.weekly.map(copyWindows)
  weekly[weekday] = copyWindows(windows)
  return { ...av, weekly }
}

/** Copies one day's windows to Monday to Friday (`'weekdays'`) or to every day (`'all'`). */
export function copyDayTo(
  av: AvailabilityDraft,
  from: number,
  to: 'weekdays' | 'all',
): AvailabilityDraft {
  const source = av.weekly[from] ?? []
  const targets = to === 'weekdays' ? WEEKDAYS : [0, 1, 2, 3, 4, 5, 6]
  const weekly = av.weekly.map((ws, d) => (targets.includes(d) ? copyWindows(source) : copyWindows(ws)))
  return { ...av, weekly }
}

export function clampSession(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SESSION_MINUTES
  return Math.max(MIN_SESSION_MINUTES, Math.min(MAX_SESSION_MINUTES, Math.round(n / 5) * 5))
}

// ─── Shift patterns ─────────────────────────────────────────────────────────

export function defaultShift(anchor: ISODate): ShiftDraft {
  return {
    preset: '3on4off',
    anchor,
    onWindows: [win('19:00', '20:30')],
    offWindows: [win('09:00', '12:00'), win('14:00', '16:00')],
  }
}

const nullIfEmpty = (ws: readonly TimeWindow[]): TimeWindow[] | null => {
  const clean = cleanWindows(ws)
  return clean.length === 0 ? null : clean
}

/** The stored cycle for a shift draft: one entry per day of the pattern, `null` for no study. */
export function shiftToPattern(shift: ShiftDraft): NonNullable<Goal['planning']['shiftPattern']> {
  return {
    anchor: shift.anchor,
    cycle: shiftCycle(SHIFT_PRESETS[shift.preset], nullIfEmpty(shift.onWindows), nullIfEmpty(shift.offWindows)).map(
      (d) => (d ? copyWindows(d) : null),
    ),
  }
}

/** Whether each day of the pattern is a work day, in order (for the small cycle strip). */
export function shiftDays(preset: ShiftPresetId): boolean[] {
  const out: boolean[] = []
  SHIFT_PRESETS[preset].forEach((n, i) => {
    for (let k = 0; k < n; k++) out.push(i % 2 === 0)
  })
  return out
}

/** The preset a stored cycle matches, with its on and off windows, or `null` for a custom cycle. */
export function shiftFromPattern(
  pattern: NonNullable<Goal['planning']['shiftPattern']>,
): ShiftDraft | null {
  const same = (a: TimeWindow[] | null, b: TimeWindow[] | null): boolean =>
    JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
  for (const id of SHIFT_PRESET_IDS) {
    const days = shiftDays(id)
    if (days.length !== pattern.cycle.length) continue
    const onIdx = days.findIndex((d) => d)
    const offIdx = days.findIndex((d) => !d)
    const on = pattern.cycle[onIdx] ?? null
    const off = offIdx === -1 ? null : (pattern.cycle[offIdx] ?? null)
    if (days.every((isOn, i) => same(pattern.cycle[i] ?? null, isOn ? on : off))) {
      return {
        preset: id,
        anchor: pattern.anchor,
        onWindows: on ? copyWindows(on) : [],
        offWindows: off ? copyWindows(off) : [],
      }
    }
  }
  return null
}

// ─── Draft ↔ planner and goal ───────────────────────────────────────────────

/** Blackout ranges that are complete and in order (what is stored), sorted by start. */
export function validBlackouts(list: readonly DraftBlackout[]): DateRange[] {
  return list
    .filter((r) => isISODate(r.start) && isISODate(r.end) && compareISODate(r.start, r.end) <= 0)
    .map<DateRange>((r) => {
      const label = r.label.replace(/\s+/g, ' ').trim()
      return label === '' ? { start: r.start as ISODate, end: r.end as ISODate } : { start: r.start as ISODate, end: r.end as ISODate, label }
    })
    .sort((a, b) => compareISODate(a.start, b.start))
}

export function toAvailabilityV2(
  av: AvailabilityDraft,
  extraBlackouts: readonly DateRange[] = [],
): AvailabilityV2 {
  const shiftPattern: ShiftPattern | null = av.shift ? shiftToPattern(av.shift) : null
  return {
    weekly: Array.from({ length: 7 }, (_, d): DayWindows => cleanWindows(av.weekly[d] ?? [])) as unknown as WeekWindows,
    sessionMinutes: clampSession(av.sessionMinutes),
    blackouts: [...validBlackouts(av.blackouts), ...extraBlackouts],
    shiftPattern,
  }
}

/** The stored availability and planning windows for a draft (the goal's own fields, not the planner's). */
export function toGoalAvailability(av: AvailabilityDraft): {
  availability: Availability
  planning: Pick<GoalPlanning, 'sessionMinutes' | 'weekly' | 'shiftPattern'>
} {
  const weekly = Array.from({ length: 7 }, (_, d) => cleanWindows(av.weekly[d] ?? []))
  return {
    availability: { minutesByWeekday: minutesFromWeekly(weekly), daysOff: validBlackouts(av.blackouts) },
    planning: {
      sessionMinutes: clampSession(av.sessionMinutes),
      weekly,
      shiftPattern: av.shift ? shiftToPattern(av.shift) : null,
    },
  }
}

/** A goal's availability as an editable draft (the Plan settings dialog). */
export function availabilityFromGoal(
  goal: Pick<Goal, 'availability' | 'planning'>,
  newKey: () => string,
): AvailabilityDraft {
  const p = goal.planning
  const stored = p.shiftPattern
  const shift = stored ? shiftFromPattern(stored) : null
  return {
    weekly: Array.from({ length: 7 }, (_, d) => copyWindows(p.weekly[d] ?? [])),
    sessionMinutes: p.sessionMinutes,
    blackouts: goal.availability.daysOff.map((r) => ({
      key: newKey(),
      start: r.start,
      end: r.end,
      label: r.label ?? '',
    })),
    // Only cycles this editor made (a preset with one set of work-day and one of day-off windows) can be
    // edited; anything else reads as no shift pattern.
    shift,
  }
}

// ─── Summaries ──────────────────────────────────────────────────────────────

const sumWindows = (ws: readonly TimeWindow[]): number =>
  windowsToIntervals(ws).reduce((n, [a, b]) => n + (b - a), 0)

/** Minutes of study windows per weekday (Sunday first), or the shift cycle's average week when one is set. */
export function weeklyWindowMinutes(av: AvailabilityDraft): number {
  if (av.shift) {
    const cycle = shiftToPattern(av.shift).cycle
    if (cycle.length === 0) return 0
    const total = cycle.reduce((n, d) => n + (d ? sumWindows(d) : 0), 0)
    return Math.round((total / cycle.length) * 7)
  }
  return av.weekly.reduce((n, ws) => n + sumWindows(ws), 0)
}

/** Study days per week (average over the cycle for a shift pattern), rounded to one decimal. */
export function studyDaysPerWeek(av: AvailabilityDraft): number {
  if (av.shift) {
    const cycle = shiftToPattern(av.shift).cycle
    if (cycle.length === 0) return 0
    const days = cycle.filter((d) => d !== null).length
    return Math.round(((days / cycle.length) * 7) * 10) / 10
  }
  return av.weekly.filter((ws) => sumWindows(ws) > 0).length
}

/** Problems that stop the plan being built, keyed for the fields; empty when fine. */
export function validateAvailability(av: AvailabilityDraft): Record<string, string> {
  const errors: Record<string, string> = {}
  if (weeklyWindowMinutes(av) === 0) {
    errors.days = av.shift
      ? 'Give the shift pattern at least one study window.'
      : 'Add at least one study window.'
  }
  av.weekly.forEach((ws, d) => {
    ws.forEach((w, i) => {
      const p = windowProblem(w)
      if (p) errors[`window:${d}:${i}`] = p
    })
  })
  if (av.shift) {
    av.shift.onWindows.forEach((w, i) => {
      const p = windowProblem(w)
      if (p) errors[`shift:on:${i}`] = p
    })
    av.shift.offWindows.forEach((w, i) => {
      const p = windowProblem(w)
      if (p) errors[`shift:off:${i}`] = p
    })
    if (!isISODate(av.shift.anchor)) errors.anchor = 'Pick the first work day of a cycle.'
  }
  for (const b of av.blackouts) {
    if (!isISODate(b.start) || !isISODate(b.end)) {
      errors[`blackout:${b.key}`] = 'Pick a start and an end date, or remove this range.'
    } else if (compareISODate(b.start, b.end) > 0) {
      errors[`blackout:${b.key}`] = 'The end is before the start.'
    }
  }
  return errors
}

/**
 * "Add X min to every study day" on a draft: the same move the planner verifies
 * (`addMinutesToWindows`: the last window ends later, then the first starts earlier).
 */
export function withExtraMinutes(av: AvailabilityDraft, minutes: number): AvailabilityDraft {
  if (minutes <= 0) return av
  const probe: AvailabilityV2 = {
    weekly: av.weekly.map(cleanWindows) as unknown as WeekWindows,
    sessionMinutes: av.sessionMinutes,
    blackouts: [],
    shiftPattern: null,
  }
  const grown = addMinutesToWindows(probe, minutes)
  const weekly = grown.weekly.map((w) => copyWindows(w))
  let shift = av.shift
  if (shift) {
    // Extend the shift's own windows through a second probe (weekday 0 = work day, 1 = day off).
    const shiftProbe = addMinutesToWindows(
      {
        weekly: [cleanWindows(shift.onWindows), cleanWindows(shift.offWindows), [], [], [], [], []] as unknown as WeekWindows,
        sessionMinutes: av.sessionMinutes,
        blackouts: [],
        shiftPattern: null,
      },
      minutes,
    )
    shift = {
      ...shift,
      onWindows: copyWindows(shiftProbe.weekly[0] ?? []),
      offWindows: copyWindows(shiftProbe.weekly[1] ?? []),
    }
  }
  return { ...av, weekly, shift }
}

