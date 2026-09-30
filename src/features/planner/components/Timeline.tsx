import { useEffect, useRef, useState } from 'react'
import { shortDate } from '@/logic/scheduler'
import { timelineModel, timelineSummary, type TimelineInput } from '@/logic/plannerTimeline'
import styles from './Timeline.module.css'

const ROW = 24
const BAR = 10
const TOP = 30
const BOTTOM = 34

/** The element's width, following resizes. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(640)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width
      if (w && w > 0) setWidth(Math.round(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s)

export interface TimelineProps extends TimelineInput {
  /** The plan fits: the finish line is calm green, else amber. */
  fits: boolean
}

/**
 * A compact month timeline drawn by hand in SVG: one bar per course, a mark for each assessment, a dashed
 * line for the target and a solid one for the projected finish. Colours are tokens (see Timeline.module.css).
 */
export function Timeline({ fits, ...input }: TimelineProps) {
  const [ref, width] = useWidth()
  const model = timelineModel(input)
  if (!model) return null

  const narrow = width < 480
  const gutter = narrow ? 64 : Math.min(150, Math.round(width * 0.24))
  const plotW = Math.max(60, width - gutter - 8)
  const height = TOP + model.bars.length * ROW + BOTTOM
  const px = (f: number): number => gutter + f * plotW
  const maxChars = Math.floor(gutter / 6.6)
  // Two labels near each other: the target sits above the plot, the finish below.
  const finishRight = model.finish !== null && px(model.finish) < width - 90

  return (
    <div ref={ref} className={styles.root}>
      <svg
        role="img"
        aria-label={timelineSummary(model)}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        {model.ticks.map((t) => (
          <g key={`${t.label}-${t.x}`}>
            <line className={styles.grid} x1={px(t.x)} x2={px(t.x)} y1={TOP - 6} y2={height - BOTTOM + 4} />
            <text className={styles.tick} x={px(t.x) + 4} y={TOP - 10}>
              {t.label}
            </text>
          </g>
        ))}

        {model.bars.map((b, i) => {
          const y = TOP + i * ROW
          return (
            <g key={b.id}>
              <text className={styles.label} x={gutter - 8} y={y + ROW / 2 + 4} textAnchor="end">
                {clip(b.label, maxChars)}
              </text>
              <rect
                className={styles.bar}
                x={px(b.x0)}
                y={y + (ROW - BAR) / 2}
                width={Math.max(3, px(b.x1) - px(b.x0))}
                height={BAR}
                rx={3}
              />
              {b.marks.map((m) => (
                <g key={m.id} transform={`translate(${px(m.x)} ${y + ROW / 2})`}>
                  <title>{`${m.title} · ${shortDate(m.date)}`}</title>
                  <rect className={styles.mark} x={-4} y={-4} width={8} height={8} transform="rotate(45)" />
                </g>
              ))}
            </g>
          )
        })}

        {model.target !== null ? (
          <g>
            <line
              className={styles.target}
              x1={px(model.target)}
              x2={px(model.target)}
              y1={TOP - 4}
              y2={height - BOTTOM + 2}
            />
            <text
              className={styles.lineLabel}
              x={px(model.target)}
              y={TOP - 22}
              textAnchor={px(model.target) > width - 60 ? 'end' : 'middle'}
            >
              Target
            </text>
          </g>
        ) : null}
        {model.finish !== null ? (
          <g>
            <line
              className={fits ? styles.finishFits : styles.finishLate}
              x1={px(model.finish)}
              x2={px(model.finish)}
              y1={TOP - 4}
              y2={height - BOTTOM + 8}
            />
            <text
              className={fits ? styles.finishTextFits : styles.finishTextLate}
              x={px(model.finish)}
              y={height - 8}
              textAnchor={finishRight ? 'start' : 'end'}
            >
              {` Finish`}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  )
}
