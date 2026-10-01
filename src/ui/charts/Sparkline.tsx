import { areaPath, linePath, linearScale } from './scale'
import styles from './Sparkline.module.css'

export interface SparklineProps {
  values: readonly number[]
  /** What it shows, for screen readers: "Focus minutes, last 30 days". */
  label: string
  /** Read out after the label. Default: the latest value and the highest. */
  summary?: string
  width?: number
  height?: number
}

const PAD = 3

/**
 * A tiny trend line with a soft wash under it and a dot on the latest value. Decorative: it is hidden
 * from assistive tech and followed by a visually hidden sentence. No tooltip, not focusable.
 */
export function Sparkline({ values, label, summary, width = 96, height = 24 }: SparklineProps) {
  const max = values.reduce((m, v) => Math.max(m, v), 0)
  const latest = values[values.length - 1]
  const text =
    summary ??
    (values.length === 0
      ? 'no data'
      : `latest ${latest ?? 0}, highest ${max}, over ${values.length} values`)

  const x = linearScale([0, Math.max(1, values.length - 1)], [PAD, width - PAD])
  const y = linearScale([0, max > 0 ? max : 1], [height - PAD, PAD])
  const points = values.map((v, i): [number, number] => [x(i), y(v)])
  const end = points[points.length - 1]

  return (
    <span className={styles.root}>
      <svg
        className={styles.svg}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        focusable="false"
      >
        {points.length > 1 && max > 0 && (
          <path className={styles.area} d={areaPath(points, height - PAD)} />
        )}
        {points.length > 1 && (
          <path className={max > 0 ? styles.line : styles.flat} d={linePath(points)} />
        )}
        {end && max > 0 && <circle className={styles.dot} cx={end[0]} cy={end[1]} r={2.5} />}
      </svg>
      <span className="sr-only">
        {label}: {text}
      </span>
    </span>
  )
}
