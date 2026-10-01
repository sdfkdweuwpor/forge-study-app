/**
 * `/settings/:section?` (BRIEF §5.9): a calm page of sections. From 760px wide the section nav is a
 * sticky column on the left that follows the scroll; below that the nav is a row of links above the
 * stacked sections. Three sections are built in (Appearance, Focus, Calendar), the others come from the
 * `settings.sections` slot in their own order (Sound, Everyday task hours, Blocker, Export & calendar,
 * later Snapshots), and Data closes the page. `/settings/<slug>` scrolls to that section.
 */
import { Suspense, useEffect, useMemo, useRef, type ComponentType, type ReactNode } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useTheme } from '@/app/providers/ThemeProvider'
import { useRegistry, type SlotProps } from '@/app/registry'
import { Link, useParams } from '@/app/router'
import { Skeleton } from '@/ui/Skeleton'
import { AppearanceSection } from './AppearanceSection'
import { CalendarSection } from './CalendarSection'
import { DataSection } from './DataSection'
import { FocusSection } from './FocusSection'
import {
  APPEARANCE,
  CALENDAR,
  DATA,
  FOCUS,
  contributedMeta,
  sectionDomId,
  type SectionMeta,
} from './sections'
import { SectionFailed } from './SettingsSection'
import { navLock, scrollToSection, type NavLock } from './sectionScroll'
import { useActiveSection } from './useActiveSection'
import { useHeldScroll } from './useHeldScroll'
import styles from './SettingsPage.module.css'

/** Wraps one section: the anchor deep links scroll to, its loading state, and its own error state. */
function Anchor({ meta, children }: { meta: SectionMeta; children: ReactNode }) {
  return (
    <div id={sectionDomId(meta.slug)} className={styles.anchor}>
      <ErrorBoundary
        fallback={(_error, reset) => <SectionFailed title={meta.title} onRetry={reset} />}
      >
        <Suspense fallback={<SectionFallback title={meta.title} />}>{children}</Suspense>
      </ErrorBoundary>
    </div>
  )
}

/** Shown while a contributed section's code loads: its title, and the shape of what is coming. */
function SectionFallback({ title }: { title: string }) {
  return (
    <div
      className={styles.fallback}
      role="status"
      aria-label={`Loading ${title.toLowerCase()} settings`}
    >
      <h2 className={styles.fallbackHeading}>{title}</h2>
      <Skeleton variant="block" height={44} />
      <Skeleton variant="block" height={44} />
    </div>
  )
}

export default function SettingsPage() {
  const registry = useRegistry()
  const { section } = useParams<'settings'>()
  const { reducedMotion } = useTheme()
  const contributions = registry.slots('settings.sections')

  const sections = useMemo(
    () => [
      { meta: APPEARANCE, node: <AppearanceSection /> },
      { meta: FOCUS, node: <FocusSection /> },
      { meta: CALENDAR, node: <CalendarSection /> },
      ...contributions.map((c) => {
        const Component = c.component as ComponentType<SlotProps['settings.sections']>
        return { meta: contributedMeta(c.id), node: <Component /> }
      }),
      { meta: DATA, node: <DataSection /> },
    ],
    [contributions],
  )
  const slugs = useMemo(() => sections.map((s) => s.meta.slug), [sections])

  const lock = useRef<NavLock | null>(null)
  const clicked = useRef<string | null>(null)
  const active = useActiveSection(slugs, lock)

  const { containerRef, hold } = useHeldScroll()

  // Arriving on `/settings/<slug>` (a link, the palette, Back) scrolls there. A nav click already has.
  useEffect(() => {
    if (!section || !slugs.includes(section)) return
    if (clicked.current === section) {
      clicked.current = null
      return
    }
    lock.current = navLock(section)
    scrollToSection(section, false)
    hold(section)
  }, [section, slugs, hold])

  function onNavClick(slug: string) {
    clicked.current = slug
    lock.current = navLock(slug)
    scrollToSection(slug, !reducedMotion)
    hold(slug)
  }

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Settings</h1>
      <div className={styles.layout}>
        <nav className={styles.nav} aria-label="Settings sections">
          <ul className={styles.navList}>
            {sections.map(({ meta }) => (
              <li key={meta.slug}>
                <Link
                  to="settings"
                  params={{ section: meta.slug }}
                  replace
                  className={styles.navLink}
                  aria-current={active === meta.slug ? 'location' : undefined}
                  onClick={() => onNavClick(meta.slug)}
                >
                  {meta.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div ref={containerRef} className={styles.sections}>
          {sections.map(({ meta, node }) => (
            <Anchor key={meta.slug} meta={meta}>
              {node}
            </Anchor>
          ))}
        </div>
      </div>
    </div>
  )
}
