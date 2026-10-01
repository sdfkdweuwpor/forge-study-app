import type { ComponentProps, CSSProperties } from 'react'
import { cx } from '../internal/cx'
import styles from './Skeleton.module.css'

export interface SkeletonProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** text: line bars that sit on the text's line height. block: a card/row. circle: an avatar/ring. */
  variant?: 'text' | 'block' | 'circle'
  /** CSS length or px. Text defaults to 100%; the last of several lines is shorter. */
  width?: number | string
  /** CSS length or px (block and circle). */
  height?: number | string
  /** Number of text lines. */
  lines?: number
}

const len = (v: number | string | undefined) => (typeof v === 'number' ? `${v}px` : v)

/**
 * Loading placeholder. Hidden from assistive tech: mark the loading region with aria-busy instead.
 * A light band sweeps across; with reduced motion it gently pulses its opacity instead.
 */
export function Skeleton({
  variant = 'text',
  width,
  height,
  lines = 1,
  className,
  style,
  ...rest
}: SkeletonProps) {
  if (variant === 'text') {
    return (
      <span
        className={cx(styles.text, className)}
        style={{ width: len(width), ...style }}
        aria-hidden="true"
        {...rest}
      >
        {Array.from({ length: Math.max(1, lines) }, (_, i) => (
          <span
            key={i}
            className={cx(styles.bone, styles.line)}
            data-motion="opacity"
            style={
              lines > 1 && i === lines - 1 ? ({ width: '62%' } satisfies CSSProperties) : undefined
            }
          />
        ))}
      </span>
    )
  }
  const size = variant === 'circle' ? (height ?? width ?? 32) : height
  return (
    <span
      className={cx(styles.bone, styles[variant], className)}
      style={{ width: len(variant === 'circle' ? size : width), height: len(size), ...style }}
      aria-hidden="true"
      data-motion="opacity"
      {...rest}
    />
  )
}
