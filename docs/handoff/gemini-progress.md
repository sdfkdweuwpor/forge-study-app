# Handoff prompt: Forge progress logic + SVG charts (Phases 6–7, standalone, detailed)

Paste everything below the line into a NEW Gemini chat (Pro). Say "continue" until it has
output every file, then bring the full answer back to Claude (paste or upload a .txt).

---

You are a senior TypeScript + React engineer. You are building one self-contained part of an
existing app called **Forge**: a calm, Notion-like study and focus app, used by a student doing a
WGU Computer Science degree. Your part is the **progress engine**:
1. pure logic for streaks (with weekly freezes), badges, statistics, insights and the weekly review;
2. a small set of hand-made, accessible **SVG chart components** in React.

Other engineers own the database, the pages and the rest of the UI. They will call your functions
with plain data and render your components. So follow the **exact file list, types and signatures**
below; integration code is written against them. Where something is unspecified, pick the simplest
option and record it in the README under "Decisions".

**Product rule, very important: no guilt mechanics.** Nothing you write may shame the user:
no "you lost your streak!", no red, no countdown-to-failure. Missing days are neutral. Freezes
protect streaks automatically. Copy is warm, short and factual.

## 0. How to deliver (you have no repository access)

- Output EVERY file. For each: one line with the full path, then the COMPLETE file in one fenced code
  block. Never write "…rest unchanged", placeholders or TODOs instead of code.
- Start with the list of all file paths. Order: types → dates helpers → streaks → badges → stats →
  insights → weeklyReview → tests → chart scale utils → chart components → CSS modules → README.
- If the answer gets long, stop after a complete file and wait for "continue".

## 1. Files (create exactly these, nothing else)

Pure logic (NO React, NO DOM, NO `Date.now()`/argument-less `new Date()`, NO `Math.random()`; time is
always passed in):
- `src/logic/progress/types.ts`: all input/output types (section 3).
- `src/logic/progress/days.ts`: tiny local-date helpers (section 2.3).
- `src/logic/progress/streaks.ts` + `streaks.test.ts`
- `src/logic/progress/badges.ts` + `badges.test.ts`
- `src/logic/progress/stats.ts` + `stats.test.ts`
- `src/logic/progress/insights.ts` + `insights.test.ts`
- `src/logic/progress/weeklyReview.ts` + `weeklyReview.test.ts`
- `src/logic/progress/index.ts`: re-exports.

React chart components (function components, no class components, no chart libraries):
- `src/ui/charts/scale.ts` + `scale.test.ts`: pure helpers (linear scale, nice ticks, path builders).
- `src/ui/charts/ChartFrame.tsx` + `ChartFrame.module.css`: shared figure/caption/hidden table/tooltip.
- `src/ui/charts/BarChart.tsx` + `BarChart.module.css`
- `src/ui/charts/Heatmap.tsx` + `Heatmap.module.css`
- `src/ui/charts/HourHistogram.tsx` (can reuse BarChart internals) + CSS module
- `src/ui/charts/HBarList.tsx` + `HBarList.module.css`
- `src/ui/charts/AccuracyScatter.tsx` + `AccuracyScatter.module.css`
- `src/ui/charts/Sparkline.tsx` + `Sparkline.module.css`
- `src/ui/charts/index.ts`: re-exports components and their prop types.
- `src/ui/charts/README.md`: usage + "Decisions / Unsure".

## 2. Code rules (CI rejects violations)

### 2.1 TypeScript / lint
- TypeScript 5.9 `strict` + `noUncheckedIndexedAccess`. No `any`, no `@ts-ignore`, no `as unknown as`,
  no non-null `!`, no `console.*`, no `eslint-disable`. React 19 + `react-jsx` runtime (no `import React`).
- Named exports only. Relative imports inside each folder. Components may import only from `react`
  and `./…` (NOT from the app).
- Vitest (`import { describe, it, expect } from 'vitest'`), tests run with `TZ=America/New_York`.
  Construct times with local constructors (`new Date(2026, 8, 29, 7, 30).getTime()`; month is 0-based).
  Pure-logic tests only; no DOM testing libraries are installed (don't test components with a DOM).

### 2.2 Styling (components)
- CSS Modules only (`import styles from './X.module.css'`). No inline colours, no hex values in CSS:
  use ONLY these CSS custom properties, which already exist in both light and dark themes:
  `--bg --bg-elevated --bg-hover --text --text-muted --text-faint --border --border-strong
  --accent --accent-soft --accent-text --success --success-text --warning --warning-text --xp --xp-text
  --fs-12 --fs-14 --fs-16 --fw-medium --fw-semibold --radius-sm --radius-md --radius-lg
  --space-1 --space-2 --space-3 --space-4 --space-6 --dur-1 --dur-2 --ease --focus-ring --shadow-pop
  --tag-gray-bg --tag-gray-text --tag-brown-bg --tag-brown-text --tag-orange-bg --tag-orange-text
  --tag-yellow-bg --tag-yellow-text --tag-green-bg --tag-green-text --tag-blue-bg --tag-blue-text
  --tag-purple-bg --tag-purple-text --tag-pink-bg --tag-pink-text --tag-red-bg --tag-red-text`.
  Heatmap intensity uses `color-mix(in srgb, var(--accent) N%, var(--bg-hover))` with N = 18/38/62/88.
- Calm look: no gradients, no drop shadows on charts (tooltip may use `--shadow-pop`), thin 1-px
  gridlines in `--border`, axis labels `--fs-12` in `--text-muted`, numbers with
  `font-variant-numeric: tabular-nums`. Bars with 2-px rounded tops. Never use red for "bad".
- Respect reduced motion: animate only with `@media (prefers-reduced-motion: no-preference)` AND not
  when an ancestor has `[data-reduced-motion='on']` (use `:root:not([data-reduced-motion='on'])` in selectors).
- The global class `sr-only` already exists (visually hidden) and can be used with `className="sr-only"`.

### 2.3 Dates (`days.ts`)
ISO local dates `'YYYY-MM-DD'`. Implement: `dayOf(ms)`, `addDays(iso, n)`, `diffDays(a, b)` (a − b),
`weekday(iso)` (0 = Sun), `startOfWeek(iso, weekStartsOn: 0 | 1)`, `eachDay(from, to)` (inclusive),
`noonMs(iso)`. Use local-time `Date` constructors so DST never shifts a day. Tests across the
2026-11-01 DST change.

## 3. Types (`types.ts`, copy exactly; you may add more)

```ts
export type ISODate = string
export type WeekStart = 0 | 1

export interface FocusSession {        // one finished focus session
  id: string; startedAt: number; endedAt: number; day: ISODate
  minutes: number                      // counted minutes (0 when not counted)
  counted: boolean                     // lasted ≥ 80% of plan (already decided by the app)
  plannedPomodoros: number | null      // for estimate accuracy (null = unknown)
  taskId: string | null; goalId: string | null; courseId: string | null
}
export interface DayRecord {           // one row per local day with activity (the app builds these)
  day: ISODate
  focusMinutes: number; focusSessions: number; pomodoros: number
  tasksDone: number; dailyGoalTarget: number; dailyGoalHit: boolean
}
export interface CompletedTask { id: string; completedAt: number; day: ISODate; estimatePomodoros: number | null; goalId: string | null; courseId: string | null }
export interface CourseDone { id: string; code: string | null; completedAt: number; termId: string | null }
export interface Term { id: string; label: string; start: ISODate; end: ISODate; courseIds: string[] }
export interface CheckInRow { at: number; hour: number; weekday: number; focus: 1 | 2 | 3 | 4 | 5 }
export interface NamedRef { id: string; title: string; color: TagColor }
export type TagColor = 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red'
export type BadgeId = 'first-focus' | 'early-bird' | 'night-owl' | 'streak-7' | 'streak-30' | 'streak-100'
  | 'deep-work' | 'first-course' | 'term-complete' | 'hours-100' | 'comeback'
```

## 4. Streaks (`streaks.ts`)

A day **qualifies** if `focusSessions ≥ 1` with at least one *counted* session, OR `dailyGoalHit`.
(The app passes DayRecords; treat `focusSessions ≥ 1 && focusMinutes > 0` as "a counted session".)

```ts
export type DayStatus = 'qualified' | 'frozen' | 'rest' | 'today-open' | 'future'
export interface StreakResult {
  current: number                 // qualified days in the current streak (frozen days don't add)
  best: number                    // best ever, same counting
  currentStart: ISODate | null
  days: { day: ISODate; status: DayStatus }[] // from the first record's day (or today-365 if later) through today
  freezesUsed: { week: ISODate; day: ISODate }[] // week = startOfWeek(day)
  freezeAvailableThisWeek: boolean
  milestonesReached: { days: 7 | 30 | 100; on: ISODate; key: string }[] // key = `streak:${days}:${currentStart}`
}
export function computeStreak(records: readonly DayRecord[], today: ISODate, weekStartsOn: WeekStart): StreakResult
```
Rules:
- Walk days chronologically. A non-qualifying **past** day (before `today`) inside a streak is
  automatically covered by a **freeze** if that week (by `weekStartsOn`) has not used its one freeze yet
  → status `frozen`, the streak continues but does not grow. Otherwise the streak ends and the day is
  `rest` (neutral wording; never "missed" or "broken").
- `today` not yet qualified → `today-open` and does NOT end the streak (the user still has today).
- Two non-qualifying days in the same week: the first is frozen, the second ends the streak.
- A freeze is only spent to bridge a gap, never before the first qualified day of a streak and never at
  the end (e.g. yesterday unqualified and today-open: yesterday uses the freeze if available, so the
  streak stays alive; if yesterday can't be frozen, current = 0 until today qualifies).
- `milestonesReached`: each time the running streak reaches exactly 7, 30 or 100, record it with the
  stable `key` (the app turns it into XP 100/500/2000 and makes it idempotent by key).
- Tests (≥ 15 cases): empty; single day; 7 straight days; gap bridged by a freeze; two gaps in one
  week (second breaks); gaps in consecutive weeks each frozen; today-open keeps the streak; yesterday
  gap + today-open; best vs current; milestone keys stable when recomputed later; weekStartsOn 0 vs 1
  changes which week a gap belongs to; DST week; 400 days of history in < 20 ms.

Also export `dailyGoalHit(pomodoros, target) = target > 0 && pomodoros >= target`.

## 5. Badges (`badges.ts`)

```ts
export interface BadgeInput {
  sessions: readonly FocusSession[]; records: readonly DayRecord[]; courses: readonly CourseDone[]
  terms: readonly Term[]; streak: StreakResult; today: ISODate
}
export interface BadgeUnlock { id: BadgeId; unlockedAt: number; context: string }
export function evaluateBadges(input: BadgeInput): BadgeUnlock[] // all badges earned so far, each once, sorted by unlockedAt
export const BADGES: readonly { id: BadgeId; title: string; description: string; hint: string; icon: string }[]
```
Definitions (use only **counted** sessions; `unlockedAt` = the moment the condition first became true):
- `first-focus`: first counted session (at its `endedAt`). Context: "25 min on <day>".
- `early-bird`: a counted session that **started** before 08:00 local.
- `night-owl`: a counted session that started at or after 22:00, or before 04:00 local.
- `deep-work`: 4 counted sessions on the same local day (at the 4th session's `endedAt`).
- `streak-7` / `streak-30` / `streak-100`: from `streak.milestonesReached` (at `noonMs(on)`).
- `first-course`: first course completion.
- `term-complete`: every course of some term completed (at the last completion); context = term label.
- `hours-100`: cumulative counted minutes reach 6,000 (at that session's `endedAt`).
- `comeback`: a new streak reaches 3 qualified days after an earlier streak of ≥ 3 had ended with at
  least one `rest` day between them (at `noonMs` of the 3rd day).
`BADGES` gives warm copy, e.g. Early Bird: title "Early Bird", description "Focused before 8 a.m.",
hint "Start a session before 8 a.m.", icon an emoji ("🌅"). Tests: each badge unlocks at the right
moment; uncounted sessions never unlock; re-running on more data never changes earlier `unlockedAt`;
empty input → [].

## 6. Stats (`stats.ts`), data for the Progress page

```ts
export function focusMinutesByDay(records: readonly DayRecord[], today: ISODate, days = 30): { day: ISODate; minutes: number }[] // oldest→today, zero-filled
export function tasksCompletedByWeek(tasks: readonly CompletedTask[], today: ISODate, weeks: number, weekStartsOn: WeekStart): { weekStart: ISODate; count: number }[]
export function minutesByGoal(sessions: readonly FocusSession[], goals: readonly NamedRef[], range: { from: ISODate; to: ISODate }): { id: string | null; title: string; color: TagColor; minutes: number }[] // desc; sessions without goal → { id: null, title: 'Other', color: 'gray' }
export function minutesByCourse(sessions: readonly FocusSession[], courses: readonly NamedRef[], range: { from: ISODate; to: ISODate }): same shape
export function hourHistogram(sessions: readonly FocusSession[], range: { from: ISODate; to: ISODate }): number[] // length 24, counted minutes split across hour boundaries (a 9:45–10:15 session adds 15 to 9 and 15 to 10)
export function estimateAccuracy(tasks: readonly CompletedTask[], sessions: readonly FocusSession[]): { points: { taskId: string; planned: number; actual: number }[]; meanRatio: number | null; within20pct: number } // actual = counted focus minutes on that task / 25, rounded to 0.5
export function yearHeatmap(records: readonly DayRecord[], streak: StreakResult, today: ISODate, weekStartsOn: WeekStart): { weeks: { weekStart: ISODate; cells: { day: ISODate; minutes: number; level: 0 | 1 | 2 | 3 | 4; frozen: boolean; future: boolean }[] }[]; max: number }
```
- `yearHeatmap` covers the 53 weeks ending with today's week; levels by quartiles of non-zero minutes
  in that range (0 = none); `frozen` from `streak.days`.
- Tests for each, incl. zero-fill, DST days, sessions crossing midnight (split by local day for
  `focusMinutesByDay` only if records are absent; otherwise trust records), hour split, rounding.

## 7. Insights (`insights.ts`)

```ts
export function bestFocusHours(checkIns: readonly CheckInRow[], minSamples = 3): { hour: number; avg: number; n: number }[] // top 3 by avg, ties by n
export function bestWeekdays(checkIns: readonly CheckInRow[], minSamples = 3): { weekday: number; avg: number; n: number }[]
export function suggestHardTaskSlots(checkIns: readonly CheckInRow[], minSamples = 3): { weekday: number; hour: number; avg: number }[] // top 5 weekday×hour cells
export function blockedAttemptsSummary(events: readonly { at: number; day: ISODate; kind: 'attempt' | 'unlock'; domain: string }[], today: ISODate): { todayAttempts: number; todayByDomain: { domain: string; count: number }[]; weekUnlocks: number; message: string }
```
- `blockedAttemptsSummary.message` examples: "You tried Instagram 7 times today, that's 7 wins."
  (pretty domain names: instagram.com → Instagram, x.com → X, youtube.com → YouTube, else capitalised
  second-level name); 0 attempts → "No distractions caught today."; unlocks are reported neutrally.
- Tests incl. minSamples filtering and message wording.

## 8. Weekly review (`weeklyReview.ts`)

```ts
export interface WeeklyReviewInput {
  weekStart: ISODate; weekStartsOn: WeekStart; today: ISODate
  records: readonly DayRecord[]; sessions: readonly FocusSession[]; tasks: readonly CompletedTask[]
  goals: readonly NamedRef[]; streak: StreakResult; badges: readonly BadgeUnlock[]
  upcoming: readonly { day: ISODate; kind: 'study' | 'review' | 'practiceTest' | 'assessment' | 'milestone' | 'task'; minutes: number; goalId: string | null }[]
}
export interface WeeklyReview {
  range: { from: ISODate; to: ISODate }
  wins: string[]            // 3–6 short, specific, positive lines, e.g. "12 tasks done", "Longest session: 50 min", "Unlocked Early Bird"
  focusMinutes: number; tasksDone: number; qualifiedDays: number; freezesUsed: number
  hoursPerGoal: { id: string | null; title: string; color: TagColor; minutes: number }[]
  streak: { current: number; best: number }
  nextWeek: { day: ISODate; minutes: number; items: number }[] // 7 entries starting next weekStart
  comparedToLastWeek: { focusMinutesDelta: number; tasksDelta: number } // neutral numbers; UI decides wording
}
export function buildWeeklyReview(input: WeeklyReviewInput): WeeklyReview
export function isReviewDay(today: ISODate, weekStartsOn: WeekStart): boolean // Sunday when weekStartsOn=1; Saturday when 0
```
Wins must never be negative ("less than last week" is not a win; skip it). Tests: a quiet week still
yields at least one kind line ("You showed up on 2 days"), and an empty week yields
["A fresh week starts Monday."] (localised to the week start).

## 9. Chart components (`src/ui/charts/`)

Shared behaviour (implement once in `ChartFrame`):
- Markup: `<figure>` → optional visible `<figcaption>` (title + optional subtitle) → `<svg role="img"
  aria-labelledby=… viewBox=… width="100%" preserveAspectRatio="none" or "xMidYMid meet" as appropriate>`
  → a `<table className="sr-only">` with the same data (caption, header row, one row per datum).
- Responsive: measure width with a `ResizeObserver` on the figure (guard for its absence) and render at
  that pixel width (so text isn't stretched); height fixed by prop. Clean up the observer.
- Keyboard + tooltip: the SVG is ONE tab stop (`tabIndex={0}`); ←/→ (and ↑/↓ for Heatmap by week
  row) move an "active datum", Home/End jump; the active datum is outlined with `--focus-ring` style and
  a tooltip shows label + formatted value; pointer hover sets the active datum too; `Escape` hides.
  An `aria-live="polite"` region announces the active datum text. Mouse leave hides the tooltip.
- Empty state: if all values are 0 or data is empty, render the frame with a calm centred line in
  `--text-muted` (prop `emptyText`, default "Nothing here yet").
- Numbers use a `format?: (n: number) => string` prop; default `Intl.NumberFormat()`.

Components and props (export the prop types):
```ts
BarChart: { data: { key: string; label: string; value: number }[]; title: string; subtitle?: string; height?: number /*160*/; format?: (n: number) => string; highlightKey?: string; emptyText?: string; tickCount?: number /*3*/ }
Heatmap: { weeks: YearHeatmap['weeks']; title: string; format?: …; weekStartsOn: 0 | 1; legend?: boolean /*true*/ } // 11-px cells, 2-px gaps, month labels on top, Mon/Wed/Fri labels left, frozen cells show a small ❄ glyph (text, not colour-only); future cells transparent; legend "Less □□□□□ More" + "❄ streak freeze"
HourHistogram: { minutes: number[] /*24*/; title: string; height?: number; format?: … } // x labels at 0, 6, 12, 18 as "12a 6a 12p 6p"; highlight the top hour
HBarList: { items: { id: string; label: string; value: number; color: TagColor }[]; title: string; format?: …; max?: number } // label left, value right, bar below in var(--tag-<color>-text) on var(--tag-<color>-bg) track
AccuracyScatter: { points: { id: string; label: string; planned: number; actual: number }[]; title: string } // x = planned pomodoros, y = actual; dashed y=x diagonal; points within ±20% in --success, others in --accent; never red
Sparkline: { values: number[]; label: string; width?: number /*96*/; height?: number /*24*/ } // decorative + sr-only text summary; no tooltip, not focusable
```
`scale.ts`: `linearScale(domain, range)`, `niceTicks(max, count)` (1-2-5 steps, includes 0),
`barPath(x, y, w, h, r)` (rounded top only), `formatHourLabel(h)`. Tests for ticks (e.g. max 47 → 0,20,40,60
with count 3), bar path shape, hour labels.

## 10. README
- `src/ui/charts/README.md`: one example per component with realistic data (focus minutes last 30
  days, tasks per week, time per goal "C182 Introduction to IT / C779 Web Development Foundations /
  Other"), the keyboard model, and "Decisions / Unsure".
- Put the logic README content (rules summary + decisions) at the top of `src/logic/progress/index.ts`
  as a doc comment instead of a separate file.

## Done means
All files above, complete, following the rules, with the tests described. Don't write pages, routes,
database code or XP storage; the app does that.
