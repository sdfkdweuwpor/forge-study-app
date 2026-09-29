import type { ReactNode } from 'react'
import styles from './Breadcrumbs.module.css'

export interface BreadcrumbItem {
  /** Stable React key; falls back to the position when omitted. */
  id?: string
  label: string
  /** Emoji page icon shown before the label. Decorative: the label carries the name. */
  icon?: string
  /** Destination handed to `renderLink`. Omit it for a crumb that is text only (a group heading). */
  href?: string
}

export interface BreadcrumbLinkProps {
  item: BreadcrumbItem
  /** Apply this to the rendered anchor so it picks up the crumb styles. */
  className: string
  /** Icon + label, already truncating. */
  children: ReactNode
}

export interface BreadcrumbsProps {
  /** Root first, current page last. The last item is the current page and is never a link. */
  items: readonly BreadcrumbItem[]
  /**
   * Renders a navigable crumb. Keeps this component router-agnostic: the app passes
   * `({ item, className, children }) => <Link to={item.href ?? '/'} className={className}>{children}</Link>`.
   * Defaults to a plain `<a href>`.
   */
  renderLink?: (props: BreadcrumbLinkProps) => ReactNode
  className?: string
}

const defaultRenderLink = ({ item, className, children }: BreadcrumbLinkProps): ReactNode => (
  <a href={item.href} className={className}>
    {children}
  </a>
)

/**
 * `Goals / WGU B.S. Computer Science / C182 Intro to IT`. Each label truncates with an ellipsis.
 * When the container is narrow (below 480px) and there are more than two crumbs, the middle ones
 * collapse into a single "…" (they stay in the accessibility tree). The nav is a size container,
 * so give it a width from its parent (`flex: 1; min-width: 0` in a flex row).
 */
export function Breadcrumbs({ items, renderLink = defaultRenderLink, className }: BreadcrumbsProps) {
  const lastIndex = items.length - 1
  const collapsible = items.length > 2

  return (
    <nav
      aria-label="Breadcrumb"
      className={className ? `${styles.nav} ${className}` : styles.nav}
      data-collapsible={collapsible || undefined}
    >
      <ol className={styles.list}>
        {items.map((item, index) => {
          const isLast = index === lastIndex
          const isMiddle = index > 0 && !isLast
          const content = (
            <>
              {item.icon ? (
                <span className={styles.icon} aria-hidden="true">
                  {item.icon}
                </span>
              ) : null}
              <span className={styles.label}>{item.label}</span>
            </>
          )

          let crumb: ReactNode
          if (isLast) {
            crumb = (
              <span className={`${styles.crumb} ${styles.current}`} aria-current="page">
                {content}
              </span>
            )
          } else if (item.href !== undefined) {
            crumb = renderLink({ item, className: `${styles.crumb} ${styles.link}`, children: content })
          } else {
            crumb = <span className={styles.crumb}>{content}</span>
          }

          return (
            <li
              key={item.id ?? `${index}:${item.label}`}
              className={styles.item}
              data-middle={isMiddle || undefined}
              data-last={isLast || undefined}
            >
              {index > 0 ? (
                <span className={styles.sep} aria-hidden="true">
                  /
                </span>
              ) : null}
              {crumb}
              {index === 0 && collapsible ? <CollapsedMarker /> : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** Shown in place of the middle crumbs when the container is narrow. Purely visual. */
function CollapsedMarker() {
  return (
    <span className={styles.collapsed} aria-hidden="true">
      <span className={styles.sep}>/</span>
      <span className={styles.ellipsis}>…</span>
    </span>
  )
}
