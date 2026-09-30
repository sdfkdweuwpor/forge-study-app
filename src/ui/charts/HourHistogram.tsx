import type { ReactNode } from 'react'
import { peakHour } from '@/logic/stats'
import { BarChart } from './BarChart'
import { formatHourLabel, hourRangeLabel } from './scale'

export interface HourHistogramProps {
  /** Focus minutes for each hour of the day, 24 entries (from `hourHistogram()`). */
  minutes: readonly number[]
  title: string
  subtitle?: string
  titleAs?: 'h2' | 'h3' | 'span'
  actions?: ReactNode
  height?: number
  /** Formats minutes for the tooltip, the table and speech. Default "45 min". */
  format?: (minutes: number) => string
  tickFormat?: (minutes: number) => string
  /** Builds the y-axis ticks (see `BarChart`). Use `niceTimeTicks` for minutes. */
  ticks?: (max: number, count: number) => number[]
  emptyText?: string
  empty?: ReactNode
}

const defaultFormat = (minutes: number): string => {
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`
}

/**
 * Focus time by hour of the day: 24 bars, labelled 12a, 6a, 12p, 6p, the busiest hour in the full accent.
 * A first arrow key lands on that hour.
 */
export function HourHistogram({
  minutes,
  title,
  subtitle,
  titleAs,
  actions,
  height = 160,
  format = defaultFormat,
  tickFormat,
  ticks,
  emptyText = 'Focus time by hour will appear after your first sessions.',
  empty,
}: HourHistogramProps) {
  const data = Array.from({ length: 24 }, (_, hour) => ({
    key: `h${hour}`,
    label: hourRangeLabel(hour),
    value: minutes[hour] ?? 0,
    tick: hour % 6 === 0 ? formatHourLabel(hour) : undefined,
  }))
  const peak = peakHour(data.map((d) => d.value))
  const peakDatum = peak === null ? undefined : data[peak]
  return (
    <BarChart
      data={data}
      title={title}
      subtitle={subtitle}
      titleAs={titleAs}
      actions={actions}
      height={height}
      format={format}
      tickFormat={tickFormat}
      ticks={ticks}
      labelHeader="Hour"
      valueHeader="Focus time"
      highlightKey={peakDatum?.key}
      initialKey={peakDatum?.key}
      emptyText={emptyText}
      empty={empty}
      summary={
        peakDatum
          ? `Focus time by hour of the day. The busiest hour is ${peakDatum.label}, with ${format(peakDatum.value)}.`
          : 'No focus time yet.'
      }
    />
  )
}
