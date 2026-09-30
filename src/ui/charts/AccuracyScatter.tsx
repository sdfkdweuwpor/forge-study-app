import type { PointerEvent, ReactNode } from 'react'
import { isWithin20 } from '@/logic/stats'
import { clusterPoints, type Cluster, type ScatterPoint } from './cluster'
import { ChartFrame, ChartLive, ChartTooltip, type ChartTooltipState } from './ChartFrame'
import { estimateTextWidth, linearScale, nearestPoint, niceTicks } from './scale'
import { useChartNav } from './useChartNav'
import styles from './AccuracyScatter.module.css'

export type { ScatterPoint } from './cluster'

export interface AccuracyScatterProps {
  points: readonly ScatterPoint[]
  title: string
  subtitle?: string
  titleAs?: 'h2' | 'h3' | 'span'
  actions?: ReactNode
  height?: number
  emptyText?: string
  empty?: ReactNode
}

const LEFT_PAD = 8
const TOP = 22
const BOTTOM = 40
const RIGHT = 12
const HIT = 24
const LABEL_FONT = 12

const num = (n: number): string => String(Math.round(n * 10) / 10)

function verdict(c: Cluster): string {
  if (c.within) return 'Within ±20% of the estimate'
  return c.actual > c.planned ? 'Took longer than planned' : 'Took less than planned'
}

/**
 * Planned against actual pomodoros. A dashed diagonal means "exactly as planned" and a soft band around
 * it is ±20 %. Dots inside the band are filled green, the rest are open rings in the accent (shape as
 * well as colour, never red). Arrow keys walk the dots in order of estimate.
 */
export function AccuracyScatter({
  points,
  title,
  subtitle,
  titleAs,
  actions,
  height = 240,
  emptyText,
  empty,
}: AccuracyScatterProps) {
  const clusters = clusterPoints(points)
  const within = points.filter((p) => isWithin20(p.planned, p.actual)).length
  const nav = useChartNav({
    count: clusters.length,
    initial: 0,
    deltas: { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 1, ArrowDown: -1 },
  })
  const active = nav.active === null ? undefined : clusters[nav.active]

  const spoken = (c: Cluster): string =>
    c.points.length === 1
      ? `${c.points[0]?.label ?? 'Task'}: planned ${num(c.planned)}, actual ${num(c.actual)}. ${verdict(c)}`
      : `${c.points.length} tasks: planned ${num(c.planned)}, actual ${num(c.actual)}. ${verdict(c)}`

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      titleAs={titleAs}
      actions={actions}
      isEmpty={points.length === 0}
      emptyText={emptyText}
      empty={empty}
      minHeight={height}
      summary={`${points.length} finished tasks, ${within} within 20% of their estimate.`}
      table={{
        headers: ['Task', 'Planned (pomodoros)', 'Actual (pomodoros)', 'Within ±20%'],
        rows: points.map((p) => [
          p.label,
          num(p.planned),
          num(p.actual),
          isWithin20(p.planned, p.actual) ? 'Yes' : 'No',
        ]),
      }}
      legend={
        <>
          <span className={styles.key}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <circle className={styles.dotWithin} cx="6" cy="6" r="4.5" />
            </svg>
            Within ±20%
          </span>
          <span className={styles.key}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <circle className={styles.dotOutside} cx="6" cy="6" r="4" />
            </svg>
            Outside ±20%
          </span>
          <span className={styles.key}>
            <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true">
              <line className={styles.diagonal} x1="1" y1="6" x2="19" y2="6" />
            </svg>
            As planned
          </span>
        </>
      }
    >
      {({ width, svgProps, svgText }) => {
        const maxValue = points.reduce((m, p) => Math.max(m, p.planned, p.actual), 0)
        const ticks = niceTicks(maxValue, 4, { integer: true })
        const top = ticks[ticks.length - 1] ?? 1
        const gutter = Math.ceil(estimateTextWidth(String(top), LABEL_FONT)) + LEFT_PAD + 4
        const plotBottom = height - BOTTOM
        const plotRight = width - RIGHT
        const x = linearScale([0, top], [gutter, plotRight])
        const y = linearScale([0, top], [plotBottom, TOP])
        const centers = clusters.map((c): [number, number] => [x(c.planned), y(c.actual)])

        const onPointer = (e: PointerEvent<SVGSVGElement>) => {
          const box = e.currentTarget.getBoundingClientRect()
          const px = e.clientX - box.left
          const py = e.clientY - box.top
          const i = nearestPoint(centers, px, py)
          const c = centers[i]
          if (c && (c[0] - px) ** 2 + (c[1] - py) ** 2 <= HIT * HIT) nav.hover(i)
          else nav.leave()
        }

        const band = [
          [0, 0],
          [top / 1.2, top],
          [top, top],
          [top, top * 0.8],
        ].map(([px, py]) => `${x(px ?? 0)},${y(py ?? 0)}`)

        let tip: ChartTooltipState | null = null
        const activeCenter = nav.active === null ? undefined : centers[nav.active]
        if (active && activeCenter) {
          const many = active.points.length > 1
          tip = {
            x: activeCenter[0],
            y: activeCenter[1] - (many ? 8 : 5),
            content: {
              value: many ? `${active.points.length} tasks` : (active.points[0]?.label ?? 'Task'),
              label: `Planned ${num(active.planned)}, actual ${num(active.actual)}`,
              note: verdict(active),
            },
          }
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
              <polygon className={styles.band} points={band.join(' ')} />
              {ticks.map((t) => (
                <g key={t}>
                  <line
                    className={t === 0 ? styles.baseline : styles.grid}
                    x1={gutter}
                    x2={plotRight}
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
                    {t}
                  </text>
                  {t > 0 && (
                    <text className={styles.tick} x={x(t)} y={plotBottom + 16} textAnchor="middle">
                      {t}
                    </text>
                  )}
                </g>
              ))}
              <line className={styles.diagonal} x1={x(0)} y1={y(0)} x2={x(top)} y2={y(top)} />
              <text className={styles.axis} x={gutter - 8} y={TOP - 10} textAnchor="start">
                Actual pomodoros
              </text>
              <text className={styles.axis} x={plotRight} y={height - 6} textAnchor="end">
                Planned pomodoros
              </text>
              {clusters.map((c, i) => {
                const center = centers[i]
                if (!center) return null
                const r = 5 + Math.min(3, c.points.length - 1)
                const isActive = i === nav.active
                return (
                  <g key={`${c.planned}/${c.actual}`}>
                    {c.within ? (
                      <circle className={styles.dotWithin} cx={center[0]} cy={center[1]} r={r} />
                    ) : (
                      <circle
                        className={styles.dotOutside}
                        cx={center[0]}
                        cy={center[1]}
                        r={r - 1}
                      />
                    )}
                    {isActive && (
                      <circle className={styles.ring} cx={center[0]} cy={center[1]} r={r + 4} />
                    )}
                  </g>
                )
              })}
            </svg>
            <ChartTooltip state={tip} plotWidth={width} />
            <ChartLive text={active ? spoken(active) : ''} />
          </>
        )
      }}
    </ChartFrame>
  )
}
