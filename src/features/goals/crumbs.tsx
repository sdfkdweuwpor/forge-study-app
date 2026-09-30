import type { MouseEvent, ReactNode } from 'react'
import { navigateToUrl } from '@/app/router'
import type { BreadcrumbLinkProps } from '@/ui/Breadcrumbs'

/** Breadcrumb links that navigate inside the app (modified clicks still open a new tab). */
export function renderCrumbLink({ item, className, children }: BreadcrumbLinkProps): ReactNode {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return
    if (item.href) {
      e.preventDefault()
      navigateToUrl(item.href)
    }
  }
  return (
    <a href={item.href} className={className} onClick={onClick}>
      {children}
    </a>
  )
}
