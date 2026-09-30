import { useEffect, useRef } from 'react'
import styles from './Dialog.module.css'

/**
 * The top of a ritual step: a three-segment progress line, "Step 2 of 3", and the step's heading. When
 * `step` changes after the first render, keyboard focus moves to the heading, so a screen reader hears
 * where it is and Tab starts at the step's first control.
 */
export function StepHeading({
  step,
  total,
  title,
}: {
  /** Zero-based. */
  step: number
  total: number
  title: string
}) {
  const heading = useRef<HTMLHeadingElement | null>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    heading.current?.focus({ preventScroll: true })
  }, [step])

  return (
    <div className={styles.stepHead}>
      <ol className={styles.stepper} aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <li
            key={i}
            className={styles.dot}
            data-state={i < step ? 'done' : i === step ? 'current' : 'todo'}
          />
        ))}
      </ol>
      <p className={styles.stepLabel}>
        Step {step + 1} of {total}
      </p>
      <h3 ref={heading} tabIndex={-1} className={styles.stepTitle}>
        {title}
      </h3>
    </div>
  )
}
