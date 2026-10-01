import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { setQuery, useQuery } from '@/app/router'
import { useShortcutHandler } from '@/app/shortcuts'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Kbd } from '@/ui/Kbd'
import { Skeleton } from '@/ui/Skeleton'
import styles from './ImportPanel.module.css'

// The flow (and Zod with it) loads the first time the panel is opened, not with the goal page.
const ImportFlow = lazy(() => import('./ImportFlow').then((m) => ({ default: m.ImportFlow })))

/**
 * "Import plan from Claude" on the goal page (`goal.panels` slot, BRIEF §5.4): a quiet row that opens the
 * copy-prompt / paste / preview flow inline. Opens on `i`, from the command palette, or with `?import=1`.
 * Importing merges into this goal: courses are matched by code, nothing is deleted.
 */
export function ImportPanel({ goalId }: { goalId: string }) {
  const [open, setOpen] = useState(false)
  /** Counts requests to show the panel, so an already-open panel is still scrolled into view. */
  const [revealed, setRevealed] = useState(0)
  const query = useQuery()
  const root = useRef<HTMLElement>(null)
  const titleId = useId()
  const bodyId = useId()

  const reveal = useCallback(() => {
    setOpen(true)
    setRevealed((n) => n + 1)
  }, [])

  useShortcutHandler('goals.import', reveal)

  // The palette command (and links) open the panel with ?import=1. The panel opens as soon as the flag
  // appears (derived while rendering, not synced in an effect); the flag itself is then removed.
  const asked = query.import === '1'
  const [seen, setSeen] = useState(false)
  if (asked !== seen) {
    setSeen(asked)
    if (asked) reveal()
  }
  useEffect(() => {
    if (asked) setQuery({ import: undefined })
  }, [asked])

  useEffect(() => {
    if (revealed > 0) root.current?.scrollIntoView({ block: 'nearest' })
  }, [revealed])

  return (
    <section ref={root} className={styles.panel} aria-labelledby={titleId}>
      <header className={styles.head}>
        <div className={styles.text}>
          <h2 id={titleId} className={styles.title}>
            Import plan from Claude
          </h2>
          <p className={styles.lede}>
            Paste a course plan as JSON. Courses are matched by code: existing ones are updated, new ones are added,
            and nothing is ever deleted.
          </p>
        </div>
        <Button
          variant={open ? 'ghost' : 'secondary'}
          iconLeft={<Sparkles />}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-keyshortcuts="i"
          onClick={() => (open ? setOpen(false) : reveal())}
        >
          {open ? 'Close' : 'Import plan'}
          {open ? null : <Kbd keys="i" size="sm" variant="plain" />}
        </Button>
      </header>

      {open ? (
        <div id={bodyId} className={styles.body}>
          <ErrorBoundary
            fallback={(_error, reset) => (
              <EmptyState
                size="sm"
                icon={<Sparkles />}
                title="The import could not load"
                description="Your goal is untouched. Try again, or reload the page."
                action={
                  <Button variant="secondary" size="sm" onClick={reset}>
                    Try again
                  </Button>
                }
              />
            )}
          >
            <Suspense
              fallback={
                <div aria-busy="true" aria-label="Loading the import" className={styles.loading}>
                  <Skeleton variant="text" width="40%" />
                  <Skeleton variant="block" height={160} />
                </div>
              }
            >
              <ImportFlow
                target={{ kind: 'goal', goalId }}
                focusOnMount
                onImported={() => setOpen(false)}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      ) : null}
    </section>
  )
}
