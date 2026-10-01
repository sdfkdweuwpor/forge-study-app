import { useId, type ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { cx } from '../internal/cx'
import styles from './Field.module.css'

export interface FieldOptions {
  id?: string
  hint?: ReactNode
  error?: ReactNode
  invalid?: boolean
  'aria-describedby'?: string
}

export interface FieldIds {
  controlId: string
  hintId: string
  errorId: string
  /** Merged aria-describedby for the control (caller's ids + hint or error). */
  describedBy: string | undefined
  isInvalid: boolean
  hasError: boolean
}

const present = (node: ReactNode) => node != null && node !== false && node !== ''

/** Ids and ARIA wiring shared by Input, Textarea and other labelled controls. */
export function useField({
  id,
  hint,
  error,
  invalid,
  'aria-describedby': describedByProp,
}: FieldOptions): FieldIds {
  const auto = useId()
  const controlId = id ?? `f${auto}`
  const hintId = `${controlId}-hint`
  const errorId = `${controlId}-error`
  const hasError = present(error)
  const message = hasError ? errorId : present(hint) ? hintId : undefined
  const describedBy = [describedByProp, message].filter(Boolean).join(' ') || undefined
  return { controlId, hintId, errorId, describedBy, isInvalid: hasError || !!invalid, hasError }
}

export interface FieldProps {
  ids: FieldIds
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  disabled?: boolean
  className?: string
  children: ReactNode
}

/** Label above, control, then one line of hint or error (an error replaces the hint). */
export function Field({ ids, label, hint, error, disabled, className, children }: FieldProps) {
  return (
    <div className={cx(styles.field, className)} data-disabled={disabled || undefined}>
      {present(label) && (
        <label htmlFor={ids.controlId} className={styles.label}>
          {label}
        </label>
      )}
      {children}
      {ids.hasError ? (
        <p id={ids.errorId} className={styles.error}>
          <CircleAlert aria-hidden="true" className={styles.errorIcon} />
          <span>{error}</span>
        </p>
      ) : (
        present(hint) && (
          <p id={ids.hintId} className={styles.hint}>
            {hint}
          </p>
        )
      )}
    </div>
  )
}
