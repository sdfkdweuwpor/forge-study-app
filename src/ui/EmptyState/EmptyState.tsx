import type { ComponentProps, ReactNode } from 'react'
import { cx } from '../internal/cx'
import styles from './EmptyState.module.css'

export interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** A lucide icon element, e.g. `<Inbox />`. */
  icon?: ReactNode
  title: ReactNode
  /** One line: why it is empty and what to do next. */
  description?: ReactNode
  /** Usually one Button; a second, quieter one is fine. */
  action?: ReactNode
  /** md: a page or a large panel. sm: a card, a sidebar section, a popover. */
  size?: 'sm' | 'md'
  align?: 'center' | 'start'
  /** Heading element for the title. */
  titleAs?: 'h2' | 'h3' | 'h4' | 'p'
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md',
  align = 'center',
  titleAs: Title = 'h3',
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div className={cx(styles.empty, className)} data-size={size} data-align={align} {...rest}>
      {icon != null && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <Title className={styles.title}>{title}</Title>
      {description != null && <p className={styles.description}>{description}</p>}
      {action != null && <div className={styles.actions}>{action}</div>}
    </div>
  )
}
