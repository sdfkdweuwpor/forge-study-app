import type { MouseEvent } from 'react'
import { Breadcrumbs, type BreadcrumbItem, type BreadcrumbLinkProps } from '@/ui/Breadcrumbs'
import type { DemoSection } from '../types'
import styles from './Composites.demo.module.css'

const TRAIL: BreadcrumbItem[] = [
  { label: 'Goals', href: '/goals' },
  { label: 'WGU B.S. Computer Science', icon: '🎓', href: '/goals/wgu-bscs' },
  { label: 'C182 Introduction to IT', icon: '📘' },
]

const LONG_TRAIL: BreadcrumbItem[] = [
  { label: 'Goals', href: '/goals' },
  {
    label: 'WGU B.S. Computer Science, Software Engineering emphasis',
    icon: '🎓',
    href: '/goals/wgu',
  },
  { label: 'Term 3 courses', href: '/goals/wgu/term-3' },
  { label: 'D278 Scripting and Programming Foundations', icon: '💻' },
]

/** Stands in for a router link (`<Link to>`): the demo never navigates. */
function demoLink({ item, className, children }: BreadcrumbLinkProps) {
  const onClick = (e: MouseEvent) => e.preventDefault()
  return (
    <a href={item.href} className={className} onClick={onClick}>
      {children}
    </a>
  )
}

/** Same, with the hover style forced on, for the state specimen. */
function hoveredLink({ item, className, children }: BreadcrumbLinkProps) {
  return (
    <a
      href={item.href}
      className={className}
      data-force="hover"
      onClick={(e) => e.preventDefault()}
    >
      {children}
    </a>
  )
}

function Demo() {
  return (
    <div className={styles.stack}>
      <div className={styles.block}>
        <span className={styles.caption}>Full trail</span>
        <Breadcrumbs items={TRAIL} renderLink={demoLink} />
      </div>

      <div className={styles.block}>
        <span className={styles.caption}>Hover on a link crumb</span>
        <Breadcrumbs items={TRAIL} renderLink={hoveredLink} />
      </div>

      <div className={styles.block}>
        <span className={styles.caption}>Narrow (320px): the middle collapses to …</span>
        <div className={`${styles.frame} ${styles.narrow}`}>
          <Breadcrumbs items={TRAIL} renderLink={demoLink} />
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.caption}>Long labels truncate with an ellipsis</span>
        <div className={`${styles.frame} ${styles.narrow}`}>
          <Breadcrumbs items={LONG_TRAIL} renderLink={demoLink} />
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.caption}>Two crumbs (240px) and a single crumb</span>
        <div className={`${styles.frame} ${styles.tight}`}>
          <Breadcrumbs items={TRAIL.slice(1)} renderLink={demoLink} />
        </div>
        <Breadcrumbs items={[{ label: 'Today', icon: '☀️' }]} />
      </div>
    </div>
  )
}

const section: DemoSection = {
  id: 'breadcrumbs',
  title: 'Breadcrumbs',
  group: 'Composites',
  order: 30,
  description:
    'The trail above a page. Router-agnostic through renderLink; the last crumb is the current page and never a link.',
  render: () => <Demo />,
}

export default section
