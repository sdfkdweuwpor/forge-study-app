import { format as formatDate } from 'date-fns'
import type { PointerEvent, ReactNode, SVGProps } from 'react'
import { fromISODate } from '@/logic/dates'
import type { YearHeatmapCell, YearHeatmapWeek } from '@/logic/stats'
import { ChartFrame, ChartLive, ChartTooltip, type ChartTooltipState } from './ChartFrame'
import { useChartNav } from './useChartNav'
import styles from './Heatmap.module.css'

export interface HeatmapProps {
  /** The grid from `yearHeatmap()`: whole weeks, oldest first, the last one holding today. */
  weeks: readonly YearHeatmapWeek[]
  /** First row of each column: 0 = Sunday, 1 = Monday. */
  weekStartsOn: 0 | 1
  title: string
  subtitle?: string
  titleAs?: 'h2' | 'h3' | 'span'
  actions?: ReactNode
  /** Formats focused minutes. Default "45 min" / "1 h 25 min". */
  format?: (minutes: number) => string
  /** Show the "Less … More" key and the freeze key. Default true. */
  legend?: boolean
  emptyText?: string
  empty?: ReactNode
}

const GAP = 2
const MIN_CELL = 10
const MAX_CELL = 14
/** Room for the Mon / Wed / Fri labels. */
const LEFT = 32
/** Room for the month names. */
const TOP = 20
const WEEKDAY_ROWS: readonly { weekday: number; label: string }[] = [
  { weekday: 1, label: 'Mon' },
  { weekday: 3, label: 'Wed' },
  { weekday: 5, label: 'Fri' },
]

const defaultFormat = (minutes: number): string => {
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`
}

const dayLabel = (day: string): string => formatDate(fromISODate(day), 'EEE, MMM d')

function cellText(cell: YearHeatmapCell, format: (minutes: number) => string) {
  if (cell.minutes > 0) return { value: format(cell.minutes), note: undefined }
  if (cell.frozen) return { value: 'Streak freeze', note: 'Your streak carried on' }
  return { value: 'No focus time', note: undefined }
}

/**
 * The streak-freeze mark: a six-spoke snowflake stroked in neutral ink, centred on a cell, with a small
 * V near the end of each spoke once the cell is big enough to show it. Drawn rather than set as a ❄
 * character, which at 10-14px falls back to whatever font has it and blurs into a dot.
 */
function FreezeGlyph({ cx, cy, size }: { cx: number; cy: number; size: number }) {
  const r = size * 0.36
  const w = size >= 13 ? 1.2 : 1.1
  const n = (v: number) => v.toFixed(2)
  const d: string[] = []
  for (const deg of [90, 30, -30, -90, -150, 150]) {
    const a = (deg * Math.PI) / 180
    const ux = Math.cos(a)
    const uy = -Math.sin(a)
    d.push(`M${n(cx)},${n(cy)}L${n(cx + ux * r)},${n(cy + uy * r)}`)
    if (size >= 12) {
      // The V: from a point 60% out, two short strokes angled 45° outward either side of the spoke.
      const bx = cx + ux * r * 0.6
      const by = cy + uy * r * 0.6
      const t = r * 0.34
      for (const turn of [Math.PI / 4, -Math.PI / 4]) {
        const vx = ux * Math.cos(turn) - uy * Math.sin(turn)
        const vy = ux * Math.sin(turn) + uy * Math.cos(turn)
        d.push(`M${n(bx)},${n(by)}L${n(bx + vx * t)},${n(by + vy * t)}`)
      }
    }
  }
  return <path className={styles.glyph} d={d.join('')} strokeWidth={w} />
}

/**
 * A GitHub-style year of days: one column per week, one row per weekday, shade = focused minutes
 * (quartiles, computed by `yearHeatmap`), a ❄ on days a streak freeze covered, month names across the
 * top and Mon/Wed/Fri down the side. On a narrow screen it shows the most recent weeks that fit at a
 * readable cell size instead of scrolling sideways. Arrow keys: left/right change week, up/down change
 * day; days that have not happened cannot be selected.
 */
export function Heatmap({
  weeks,
  weekStartsOn,
  title,
  subtitle,
  titleAs,
  actions,
  format = defaultFormat,
  legend = true,
  emptyText,
  empty,
}: HeatmapProps) {
  const cells = weeks.flatMap((w) => w.cells)
  const total = cells.reduce((sum, c) => sum + c.minutes, 0)
  const activeDays = cells.filter((c) => c.minutes > 0).length
  const freezes = cells.filter((c) => c.frozen).length

  return (
    <ChartFrame
      className={styles.root}
      title={title}
      subtitle={subtitle}
      titleAs={titleAs}
      actions={actions}
      isEmpty={activeDays === 0 && freezes === 0}
      emptyText={emptyText}
      empty={empty}
      minHeight={TOP + 7 * (MAX_CELL + GAP) - GAP + 2}
      summary={`${activeDays} days with focus time, ${format(total)} in total${
        freezes > 0 ? `, ${freezes} covered by a streak freeze` : ''
      }. Days with no focus time are left out of the table.`}
      table={{
        headers: ['Day', 'Focus time', 'Streak freeze'],
        rows: cells
          .filter((c) => c.minutes > 0 || c.frozen)
          .map((c) => [
            dayLabel(c.day),
            c.minutes > 0 ? format(c.minutes) : '',
            c.frozen ? 'Yes' : '',
          ]),
      }}
      legend={
        legend ? (
          <>
            <span className={styles.key}>
              Less
              <span className={styles.swatches} aria-hidden="true">
                {[0, 1, 2, 3, 4].map((level) => (
                  <span key={level} className={styles.swatch} data-level={level} />
                ))}
              </span>
              More
            </span>
            <span className={styles.key}>
              <svg
                className={styles.legendGlyph}
                width="12"
                height="12"
                viewBox="0 0 12 12"
                aria-hidden="true"
              >
                <rect className={styles.cell} data-level={0} width="12" height="12" rx="2" />
                <FreezeGlyph cx={6} cy={6} size={12} />
              </svg>
              Streak freeze
            </span>
          </>
        ) : undefined
      }
    >
      {({ width, svgProps, svgText }) => (
        <HeatmapGrid
          width={width}
          svgProps={svgProps}
          svgText={svgText}
          weeks={weeks}
          weekStartsOn={weekStartsOn}
          format={format}
        />
      )}
    </ChartFrame>
  )
}

interface GridProps {
  width: number
  svgProps: SVGProps<SVGSVGElement>
  svgText: ReactNode
  weeks: readonly YearHeatmapWeek[]
  weekStartsOn: 0 | 1
  format: (minutes: number) => string
}

function HeatmapGrid({ width, svgProps, svgText, weeks, weekStartsOn, format }: GridProps) {
  // As many recent weeks as fit at a readable size; the older ones are left off rather than scrolled to.
  const fit = Math.max(1, Math.floor((width - LEFT) / (MIN_CELL + GAP)))
  const visible = Math.min(weeks.length, fit)
  const shown = weeks.slice(weeks.length - visible)
  const step = Math.min(MAX_CELL, Math.floor((width - LEFT) / visible) - GAP) + GAP
  const cell = step - GAP
  const height = TOP + 7 * step - GAP + 2
  const cells = shown.flatMap((w) => w.cells)

  let todayIndex = 0
  cells.forEach((c, i) => {
    if (!c.future) todayIndex = i
  })

  const nav = useChartNav({
    count: cells.length,
    initial: todayIndex,
    deltas: { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 },
    enabled: (i) => cells[i]?.future === false,
  })

  const origin = (index: number): { x: number; y: number } => ({
    x: LEFT + Math.floor(index / 7) * step,
    y: TOP + (index % 7) * step,
  })

  const activeCell = nav.active === null ? undefined : cells[nav.active]
  let tip: ChartTooltipState | null = null
  let spoken = ''
  if (activeCell && nav.active !== null) {
    const { x, y } = origin(nav.active)
    const text = cellText(activeCell, format)
    tip = {
      x: x + cell / 2,
      y: y - 2,
      bottom: y + cell + 2,
      content: { value: text.value, label: dayLabel(activeCell.day), note: text.note },
    }
    spoken = `${dayLabel(activeCell.day)}: ${text.value}`
  }

  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const col = Math.floor((e.clientX - box.left - LEFT) / step)
    const row = Math.floor((e.clientY - box.top - TOP) / step)
    if (col < 0 || col >= visible || row < 0 || row > 6) return nav.leave()
    const index = col * 7 + row
    if (cells[index]?.future === false) nav.hover(index)
    else nav.leave()
  }

  // A month name over the first column of each month, when there is room for it.
  const months: { col: number; text: string }[] = []
  let lastMonth = -1
  let lastCol = -99
  const minGap = Math.ceil(28 / step)
  shown.forEach((w, col) => {
    const first = w.cells[0]
    if (!first) return
    const month = fromISODate(first.day).getMonth()
    if (month === lastMonth) return
    lastMonth = month
    // The first column only gets a name when its month is not about to change.
    const next = shown[1]?.cells[0]
    if (col === 0 && next && fromISODate(next.day).getMonth() !== month) return
    if (col - lastCol < minGap) return
    lastCol = col
    months.push({ col, text: formatDate(fromISODate(first.day), 'MMM') })
  })

  const rowOf = (weekday: number): number => (weekday - weekStartsOn + 7) % 7
  const ring = nav.active === null ? null : origin(nav.active)

  return (
    <>
      <svg
        {...svgProps}
        {...nav.handlers}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'touch') nav.leave()
        }}
      >
        {svgText}
        {months.map((m) => (
          <text key={m.col} className={styles.label} x={LEFT + m.col * step} y={TOP - 8}>
            {m.text}
          </text>
        ))}
        {WEEKDAY_ROWS.map(({ weekday, label }) => (
          <text
            key={weekday}
            className={styles.label}
            x={0}
            y={TOP + rowOf(weekday) * step + cell / 2}
            dy="0.35em"
          >
            {label}
          </text>
        ))}
        {cells.map((c, i) => {
          if (c.future) return null
          const { x, y } = origin(i)
          return (
            <g key={c.day}>
              <rect
                className={styles.cell}
                data-level={c.level}
                data-today={i === todayIndex ? '' : undefined}
                x={x}
                y={y}
                width={cell}
                height={cell}
                rx={2}
              />
              {c.frozen && <FreezeGlyph cx={x + cell / 2} cy={y + cell / 2} size={cell} />}
            </g>
          )
        })}
        {ring && (
          <>
            <rect
              className={styles.halo}
              x={ring.x - 0.5}
              y={ring.y - 0.5}
              width={cell + 1}
              height={cell + 1}
              rx={2.5}
            />
            <rect
              className={styles.ring}
              x={ring.x - 2}
              y={ring.y - 2}
              width={cell + 4}
              height={cell + 4}
              rx={3.5}
            />
          </>
        )}
      </svg>
      <ChartTooltip state={tip} plotWidth={width} />
      <ChartLive text={spoken} />
    </>
  )
}
