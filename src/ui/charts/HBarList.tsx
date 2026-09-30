import type { PointerEvent, ReactNode } from 'react'
import type { TagColor } from '../Tag'
import { ChartFrame, ChartLive, ChartTooltip, type ChartTooltipState } from './ChartFrame'
import { estimateTextWidth, truncateLabel } from './scale'
import { useChartNav } from './useChartNav'
import styles from './HBarList.module.css'

export interface HBarItem {
  id: string
  label: string
  value: number
  /** One of the tag colours: the bar is `--tag-<color>-text` on a `--tag-<color>-bg` track. */
  color: TagColor
}

export interface HBarListProps {
  items: readonly HBarItem[]
  title: string
  subtitle?: string
  titleAs?: 'h2' | 'h3' | 'span'
  actions?: ReactNode
  /** Formats a value for the row, the tooltip, the table and speech. Default "45 min" / "1 h 25 min". */
  format?: (value: number) => string
  /** The value that fills a whole track. Default: the largest value. */
  max?: number
  labelHeader?: string
  valueHeader?: string
  emptyText?: string
  empty?: ReactNode
}

const ROW = 40
const ROW_GAP = 0
const LABEL_FONT = 14
const VALUE_FONT = 13
const TRACK_H = 6
const TRACK_Y = 24

const defaultFormat = (value: number): string => {
  const m = Math.round(value)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`
}

/**
 * Ranked rows: the name on the left, the value on the right, a thin bar under both in the item's tag
 * colour. Up and down (or left and right) move between rows; a tooltip adds the share of the total.
 */
export function HBarList({
  items,
  title,
  subtitle,
  titleAs,
  actions,
  format = defaultFormat,
  max,
  labelHeader = 'Name',
  valueHeader = 'Value',
  emptyText,
  empty,
}: HBarListProps) {
  const total = items.reduce((sum, i) => sum + i.value, 0)
  const scaleMax = Math.max(max ?? 0, ...items.map((i) => i.value))
  const nav = useChartNav({
    count: items.length,
    initial: 0,
    deltas: { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1 },
  })
  const active = nav.active === null ? undefined : items[nav.active]
  const share = (value: number): string =>
    total > 0 ? `${Math.round((value / total) * 100)}% of the total` : ''

  const top = items[0]
  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      titleAs={titleAs}
      actions={actions}
      isEmpty={items.length === 0 || scaleMax <= 0}
      emptyText={emptyText}
      empty={empty}
      minHeight={Math.max(1, items.length) * ROW}
      summary={
        top
          ? `${items.length} items. The largest is ${top.label} with ${format(top.value)}.`
          : 'No items.'
      }
      table={{
        headers: [labelHeader, valueHeader, 'Share'],
        rows: items.map((i) => [
          i.label,
          format(i.value),
          total > 0 ? `${Math.round((i.value / total) * 100)}%` : '',
        ]),
      }}
    >
      {({ width, svgProps, svgText }) => {
        const height = Math.max(1, items.length) * ROW - ROW_GAP
        const valueWidth = Math.max(
          ...items.map((i) => estimateTextWidth(format(i.value), VALUE_FONT)),
        )
        const labelRoom = Math.max(40, width - valueWidth - 16)

        const onPointer = (e: PointerEvent<SVGSVGElement>) => {
          const box = e.currentTarget.getBoundingClientRect()
          const row = Math.floor((e.clientY - box.top) / ROW)
          if (row >= 0 && row < items.length) nav.hover(row)
          else nav.leave()
        }

        let tip: ChartTooltipState | null = null
        if (active && nav.active !== null) {
          const fill = scaleMax > 0 ? Math.min(1, active.value / scaleMax) * width : 0
          tip = {
            x: Math.min(Math.max(fill, 24), width - 24),
            y: nav.active * ROW + ROW - 8,
            placement: 'below',
            content: {
              value: format(active.value),
              label: active.label,
              note: share(active.value),
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
              {items.map((item, i) => {
                const y = i * ROW
                const fill =
                  scaleMax > 0 ? Math.max(0, Math.min(1, item.value / scaleMax)) * width : 0
                return (
                  <g
                    key={item.id}
                    className={styles.row}
                    data-active={i === nav.active ? '' : undefined}
                    data-color={item.color}
                  >
                    {/* 4px past the text on each side: inside the chart's focus ring, never through it. */}
                    <rect
                      className={styles.wash}
                      x={-4}
                      y={y}
                      width={width + 8}
                      height={ROW - 4}
                      rx={4}
                    />
                    <text className={styles.label} x={0} y={y + 16} fontSize={LABEL_FONT}>
                      {truncateLabel(item.label, labelRoom, LABEL_FONT)}
                    </text>
                    <text
                      className={styles.value}
                      x={width}
                      y={y + 16}
                      textAnchor="end"
                      fontSize={VALUE_FONT}
                    >
                      {format(item.value)}
                    </text>
                    <rect
                      className={styles.track}
                      x={0}
                      y={y + TRACK_Y}
                      width={width}
                      height={TRACK_H}
                      rx={TRACK_H / 2}
                    />
                    {fill > 0 && (
                      <rect
                        className={styles.fill}
                        x={0}
                        y={y + TRACK_Y}
                        width={Math.max(fill, TRACK_H)}
                        height={TRACK_H}
                        rx={TRACK_H / 2}
                      />
                    )}
                  </g>
                )
              })}
            </svg>
            <ChartTooltip state={tip} plotWidth={width} />
            <ChartLive
              text={
                active
                  ? `${active.label}: ${format(active.value)}${total > 0 ? `, ${share(active.value)}` : ''}`
                  : ''
              }
            />
          </>
        )
      }}
    </ChartFrame>
  )
}
