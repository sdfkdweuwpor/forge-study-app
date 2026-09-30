import type { ComponentProps, ReactNode } from 'react'
import { CircleAlert, CircleCheck, Sparkles, Undo2, X } from 'lucide-react'
import { Button } from '../Button'
import { IconButton } from '../IconButton'
import { cx } from '../internal/cx'
import type { ToastVariant, UndoPhase } from './toastReducer'
import styles from './Toast.module.css'

export interface ToastCardProps extends Omit<ComponentProps<'div'>, 'title'> {
  variant?: ToastVariant
  title: string
  description?: string
  /** Where the optional Undo action is. `undone` and `undoFailed` replace the message. */
  phase?: UndoPhase
  /** Why a failed undo was refused; replaces "Try again" and hides Retry. */
  undoRefusal?: string | undefined
  /** Shows an Undo button (ignored once undone). */
  onUndo?: () => void
  /** Shows an action button (ignored once undone or while an undo failed). */
  action?: { label: string; onClick: () => void }
  /** Shows a dismiss (X) button. */
  onDismiss?: () => void
}

const ICONS: Record<ToastVariant, ReactNode> = {
  default: null,
  success: <CircleCheck />,
  error: <CircleAlert />,
  xp: <Sparkles />,
}

/**
 * One toast. Inverse surface (`--bg-inverse`), so it reads on any page. Its content sits in a dark
 * theme scope: status colours, the buttons and their hover states then resolve to values made for
 * a dark surface even while the page is light.
 */
export function ToastCard({
  variant = 'default',
  title,
  description,
  phase = 'idle',
  undoRefusal,
  onUndo,
  action,
  onDismiss,
  className,
  ...rest
}: ToastCardProps) {
  const undone = phase === 'undone'
  const failed = phase === 'undoFailed'
  const shownVariant: ToastVariant = failed ? 'error' : undone ? 'success' : variant
  const icon = undone ? <Undo2 /> : ICONS[shownVariant]
  const heading = undone ? 'Undone' : failed ? 'Couldn’t undo' : title
  const refused = failed && undoRefusal !== undefined
  const detail = undone
    ? undefined
    : refused
      ? undoRefusal
      : failed
        ? 'Nothing was changed. Try again.'
        : description

  return (
    <div className={cx(styles.toast, className)} data-variant={shownVariant} {...rest}>
      <div className={styles.content} data-theme="dark">
        {icon && (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        )}
        <div className={styles.text}>
          <p className={styles.title}>{heading}</p>
          {detail && <p className={styles.description}>{detail}</p>}
        </div>
        <div className={styles.actions}>
          {action && !undone && !failed && (
            <Button variant="ghost" size="sm" className={styles.undo} onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {onUndo && !undone && !refused && (
            <Button
              variant="ghost"
              size="sm"
              className={styles.undo}
              loading={phase === 'undoing'}
              onClick={onUndo}
            >
              {failed ? 'Retry' : 'Undo'}
            </Button>
          )}
          {onDismiss && <IconButton label="Dismiss" icon={<X />} size="sm" onClick={onDismiss} />}
        </div>
      </div>
    </div>
  )
}
