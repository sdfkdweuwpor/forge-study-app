import type { ComponentProps, ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from '../IconButton'
import { cx } from '../internal/cx'
import styles from './Modal.module.css'

export type ModalSize = 'sm' | 'md' | 'lg'

export interface ModalPanelProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: string
  /** Muted line under the title. */
  description?: ReactNode
  /** Actions, right-aligned. Put the primary action last. */
  footer?: ReactNode
  size?: ModalSize
  /** Keep the title for screen readers only. */
  hideTitle?: boolean
  /** Shows the close (X) button when given. */
  onClose?: () => void
  titleId?: string
  descriptionId?: string
  /** Called with the close button element, so the modal can leave it out of the initial focus. */
  closeRef?: (el: HTMLButtonElement | null) => void
  /** Draw in normal flow, without the entrance animation. For /design specimens. */
  inline?: boolean
}

/**
 * The dialog surface: 14px radius, title, scrolling body, footer. Modal wraps it in a scrim,
 * focus trap and portal; /design also renders it on its own.
 */
export function ModalPanel({
  title,
  description,
  footer,
  size = 'md',
  hideTitle,
  onClose,
  titleId,
  descriptionId,
  closeRef,
  inline,
  className,
  children,
  ...rest
}: ModalPanelProps) {
  return (
    <div
      data-motion="opacity"
      data-size={size}
      data-inline={inline || undefined}
      className={cx(styles.panel, className)}
      {...rest}
    >
      <header className={styles.header} data-hidden={hideTitle || undefined}>
        <div className={styles.heading}>
          <h2 id={titleId} className={hideTitle ? 'sr-only' : styles.title}>
            {title}
          </h2>
          {description != null && (
            <p id={descriptionId} className={styles.description}>
              {description}
            </p>
          )}
        </div>
        {onClose && (
          <IconButton
            ref={closeRef}
            label="Close"
            icon={<X />}
            onClick={onClose}
            className={styles.close}
          />
        )}
      </header>
      <div className={styles.body}>{children}</div>
      {footer != null && <footer className={styles.footer}>{footer}</footer>}
    </div>
  )
}
