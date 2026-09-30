import {
  useId,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type SVGProps,
} from 'react'
import { cx } from '../internal/cx'
import { clamp } from './scale'
import { useElementWidth } from './useElementWidth'
import styles from './ChartFrame.module.css'

/** What a tooltip says: the value first, then what it is a value of. */
export interface ChartTooltipContent {
  /** "1 h 25 min" */
  value: string
  /** "Tue, Sep 29" */
  label: string
  /** An optional third line, e.g. "Streak freeze". */
  note?: string
}

export interface ChartTooltipState {
  /** Anchor in plot pixels (the point the tooltip hangs above, or below with `placement: 'below'`). */
  x: number
  y: number
  /** Default `above`. A list whose rows sit under each other puts it `below`, so it never covers the heading. */
  placement?: 'above' | 'below'
  content: ChartTooltipContent
}

/** The hidden data table: the same numbers as the picture, for screen readers. */
export interface ChartTable {
  headers: readonly string[]
  rows: readonly (readonly string[])[]
}

/** What a chart spreads onto its `<svg>` and renders inside it, so the frame owns the wiring. */
export interface ChartSvgContext {
  /** Plot width in px. Charts draw at this width. */
  width: number
  /** `role`, `aria-*`, `tabIndex` and the class: spread on the `<svg>`. */
  svgProps: SVGProps<SVGSVGElement>
  /** `<title>` and `<desc>`: render as the first children of the `<svg>`. */
  svgText: ReactNode
}

export interface ChartFrameProps {
  title: string
  subtitle?: string
  /** Heading level of the visible title. A page section uses `h2`. Default: plain text. */
  titleAs?: 'h2' | 'h3' | 'span'
  /** Controls beside the title (a segmented toggle). */
  actions?: ReactNode
  /** True for no data (or all zeros): the frame shows the empty state instead of a chart. */
  isEmpty: boolean
  /** The calm one-liner of the empty state. */
  emptyText?: string
  /** Replaces the one-liner, e.g. with a link to what to do. */
  empty?: ReactNode
  /** The data table read by screen readers. */
  table: ChartTable
  /** One sentence describing the whole chart (the SVG's description). */
  summary: string
  /** A key under the picture (heatmap legend, scatter key). */
  legend?: ReactNode
  /** Height in px to reserve while the width is measured, so nothing jumps. */
  minHeight?: number
  className?: string
  children: (context: ChartSvgContext) => ReactNode
}

const TOOLTIP_GAP = 8

/**
 * The tooltip bubble. A chart renders it next to its `<svg>` (inside the frame's plot) because only the
 * chart knows the anchor. Decorative: what it says is spoken by the frame's live region.
 */
export function ChartTooltip({
  state,
  plotWidth,
}: {
  state: ChartTooltipState | null
  plotWidth: number
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const x = state?.x ?? 0
  const y = state?.y ?? 0
  const content = state?.content
  // Measured after render and written straight to the element (no state), so it never flashes at the
  // wrong place: centred over the anchor, kept inside the plot, above it unless there is no room.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = clamp(x - w / 2, 0, Math.max(0, plotWidth - w))
    const above = y - h - TOOLTIP_GAP
    const top = state?.placement === 'below' || above < -h ? y + TOOLTIP_GAP : above
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
    el.style.visibility = 'visible'
  }, [x, y, plotWidth, content, state?.placement])
  if (!content) return null
  return (
    <div ref={ref} className={styles.tooltip} aria-hidden="true" data-testid="chart-tooltip">
      <span className={styles.tipValue}>{content.value}</span>
      <span className={styles.tipLabel}>{content.label}</span>
      {content.note && <span className={styles.tipNote}>{content.note}</span>}
    </div>
  )
}

/** A polite live region: renders what the active datum says, so it is spoken as the arrows move. */
export function ChartLive({ text }: { text: string }) {
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {text}
    </div>
  )
}

/**
 * The shell every chart shares: a `<figure>` with a caption (title, subtitle, optional controls), a
 * plot measured by `ResizeObserver` so charts draw at real pixel width, a tooltip, a polite live
 * region that speaks the active datum, a visually hidden data table, and the empty state. The chart
 * itself is one `<svg role="img">`, a single tab stop that the arrow keys walk (see `useChartNav`).
 */
export function ChartFrame({
  title,
  subtitle,
  titleAs: Title = 'span',
  actions,
  isEmpty,
  emptyText = 'Nothing here yet',
  empty,
  table,
  summary,
  legend,
  minHeight,
  className,
  children,
}: ChartFrameProps) {
  const [plotRef, width] = useElementWidth<HTMLDivElement>()
  const base = useId()
  const titleId = `${base}-t`
  const descId = `${base}-d`
  const hintId = `${base}-h`

  const svgProps: SVGProps<SVGSVGElement> = {
    role: 'img',
    'aria-labelledby': titleId,
    'aria-describedby': `${descId} ${hintId}`,
    tabIndex: 0,
    className: styles.svg,
  }
  const svgText = (
    <>
      <title id={titleId}>{title}</title>
      <desc id={descId}>{summary}</desc>
    </>
  )

  return (
    <figure className={cx(styles.figure, className)}>
      <figcaption className={styles.caption}>
        <div className={styles.heading}>
          <Title className={styles.title}>{title}</Title>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </figcaption>

      {isEmpty ? (
        <div className={styles.empty}>
          {empty ?? <p className={styles.emptyText}>{emptyText}</p>}
        </div>
      ) : (
        <>
          <div
            ref={plotRef}
            className={styles.plot}
            // Only until the width is known, so the frame does not jump; the chart sets its own height.
            style={minHeight && width === 0 ? ({ minHeight } as CSSProperties) : undefined}
          >
            {width > 0 && children({ width, svgProps, svgText })}
          </div>
          {legend && <div className={styles.legend}>{legend}</div>}
          <p id={hintId} className="sr-only">
            Use the arrow keys to move between values. Press Escape to hide the tooltip.
          </p>
          {/* In a clipped box: a table ignores a 1px width and would widen the page. */}
          <div className="sr-only">
            <table>
              <caption>{subtitle ? `${title}. ${subtitle}` : title}</caption>
              <thead>
                <tr>
                  {table.headers.map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </figure>
  )
}
