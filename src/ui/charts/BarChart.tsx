import type { PointerEvent, ReactNode } from 'react'
import { ChartFrame, ChartLive, ChartTooltip, type ChartTooltipState } from './ChartFrame'
import { useChartNav } from './useChartNav'
import {
  bandLayout,
  barPath,
  estimateTextWidth,
  linearScale,
  niceTicks,
  showsTick,
  tickStep,
} from './scale'
import styles from './BarChart.module.css'

export interface BarDatum {
  /** Stable id (an ISO day, a week start). */
  key: string
  /** The full name, used in the tooltip, the table and what is spoken: "Tue, Sep 29". */
  label: string
  value: number
  /** A short axis label ("Sep 29"). Bars without one get none. Crowded labels are thinned out. */
  tick?: string
}

export interface BarChartProps {
  data: readonly BarDatum[]
  title: string
  subtitle?: string
  titleAs?: 'h2' | 'h3' | 'span'
  /** Controls beside the title. */
  actions?: ReactNode
  /** Total height in px, axis included. Default 160. */
  height?: number
  /** Formats a value for the tooltip, the table and speech. Default: locale number. */
  format?: (value: number) => string
  /** Formats the y-axis labels. Default: `format`. */
  tickFormat?: (value: number) => string
  /** Whole-number y-axis steps (counts). */
  integerTicks?: boolean
  /** Number of y-axis intervals, about. Default 3. */
  tickCount?: number
  /** Builds the y-axis ticks (from 0 to at least `max`). Default: 1-2-5 steps; use `niceTimeTicks` for minutes. */
  ticks?: (max: number, count: number) => number[]
  /** Column headers of the hidden table. */
  labelHeader?: string
  valueHeader?: string
  /** The bar drawn in the full accent (today, the busiest hour); the rest are softer. */
  highlightKey?: string
  /** The bar a first key press lands on. Default: the last. */
  initialKey?: string
  emptyText?: string
  empty?: ReactNode
  legend?: ReactNode
  /** Overrides the generated one-sentence description. */
  summary?: string
}

const TOP = 8
const AXIS = 22
const LABEL_FONT = 12
const RADIUS = 3

const defaultFormat = (n: number): string => new Intl.NumberFormat().format(n)

/**
 * A column chart: thin bars with rounded tops on one baseline, hairline gridlines, and a y-axis that
 * starts at 0. Hover or the arrow keys pick a bar; a tooltip and a spoken line say what it is. All
 * zeros or no data shows the empty state.
 */
export function BarChart({
  data,
  title,
  subtitle,
  titleAs,
  actions,
  height = 160,
  format = defaultFormat,
  tickFormat,
  integerTicks = false,
  tickCount = 3,
  ticks: makeTicks,
  labelHeader = 'Label',
  valueHeader = 'Value',
  highlightKey,
  initialKey,
  emptyText,
  empty,
  legend,
  summary,
}: BarChartProps) {
  const fmtTick = tickFormat ?? format
  const max = data.reduce((m, d) => Math.max(m, d.value), 0)
  const initialFound = initialKey === undefined ? -1 : data.findIndex((d) => d.key === initialKey)
  const initial = initialFound >= 0 ? initialFound : Math.max(0, data.length - 1)

  const nav = useChartNav({
    count: data.length,
    initial,
    deltas: { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 },
  })

  const active = nav.active === null ? undefined : data[nav.active]
  const peak = data.reduce<BarDatum | undefined>(
    (best, d) => (best === undefined || d.value > best.value ? d : best),
    undefined,
  )

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      titleAs={titleAs}
      actions={actions}
      isEmpty={data.length === 0 || max <= 0}
      emptyText={emptyText}
      empty={empty}
      legend={legend}
      minHeight={height}
      summary={
        summary ??
        (peak
          ? `${data.length} values. The highest is ${peak.label} at ${format(peak.value)}.`
          : 'No values.')
      }
      table={{
        headers: [labelHeader, valueHeader],
        rows: data.map((d) => [d.label, format(d.value)]),
      }}
    >
      {({ width, svgProps, svgText }) => {
        const ticks = makeTicks
          ? makeTicks(max, tickCount)
          : niceTicks(max, tickCount, { integer: integerTicks })
        const top = ticks[ticks.length - 1] ?? 1
        const gutter =
          Math.ceil(Math.max(...ticks.map((t) => estimateTextWidth(fmtTick(t), LABEL_FONT)))) + 10
        const plotBottom = height - AXIS
        const y = linearScale([0, top], [plotBottom, TOP])
        const layout = bandLayout(data.length, gutter, Math.max(1, width - gutter))
        const labelWidth = Math.max(
          ...data.map((d) => (d.tick ? estimateTextWidth(d.tick, LABEL_FONT) : 0)),
        )
        // A last label wider than its bar is pulled back inside the chart, so the ones before it need the
        // extra room too.
        const step = tickStep(
          layout.pitch,
          Math.max(labelWidth, labelWidth * 1.5 - layout.pitch / 2),
        )

        const activeX = nav.active === null ? 0 : layout.bandX(nav.active) + layout.pitch / 2
        const activeTop = active ? Math.min(y(active.value), plotBottom - 1) : 0
        const tip: ChartTooltipState | null = active
          ? {
              x: activeX,
              y: activeTop,
              content: { value: format(active.value), label: active.label },
            }
          : null

        const onPointer = (e: PointerEvent<SVGSVGElement>) => {
          const box = e.currentTarget.getBoundingClientRect()
          nav.hover(layout.indexAt(e.clientX - box.left))
        }

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
              {ticks.map((t) => (
                <g key={t}>
                  <line
                    className={t === 0 ? styles.baseline : styles.grid}
                    x1={gutter}
                    x2={width}
                    y1={y(t)}
                    y2={y(t)}
                  />
                  <text
                    className={styles.tick}
                    x={gutter - 8}
                    y={y(t)}
                    textAnchor="end"
                    dy="0.32em"
                  >
                    {fmtTick(t)}
                  </text>
                </g>
              ))}
              {active && nav.active !== null && (
                <rect
                  className={styles.band}
                  x={layout.bandX(nav.active)}
                  y={TOP}
                  width={layout.pitch}
                  height={plotBottom - TOP}
                  rx={RADIUS}
                />
              )}
              {data.map((d, i) => {
                const h = plotBottom - y(d.value)
                const x = layout.barX(i)
                const isActive = i === nav.active
                return d.value > 0 ? (
                  <path
                    key={d.key}
                    className={styles.bar}
                    data-highlight={d.key === highlightKey || isActive ? '' : undefined}
                    d={barPath(x, plotBottom - h, layout.barWidth, h, RADIUS)}
                  />
                ) : (
                  <rect
                    key={d.key}
                    className={styles.zero}
                    x={x}
                    y={plotBottom - 1}
                    width={layout.barWidth}
                    height={1}
                  />
                )
              })}
              {data.map((d, i) => {
                if (!d.tick || !showsTick(i, data.length, step)) return null
                const overflows =
                  i === data.length - 1 && estimateTextWidth(d.tick, LABEL_FONT) > layout.pitch
                return (
                  <text
                    key={d.key}
                    className={styles.tick}
                    x={overflows ? width : layout.bandX(i) + layout.pitch / 2}
                    y={plotBottom + 15}
                    textAnchor={overflows ? 'end' : 'middle'}
                  >
                    {d.tick}
                  </text>
                )
              })}
            </svg>
            <ChartTooltip state={tip} plotWidth={width} />
            <ChartLive text={active ? `${active.label}: ${format(active.value)}` : ''} />
          </>
        )
      }}
    </ChartFrame>
  )
}
