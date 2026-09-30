import { lazy, Suspense, useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { href, navigate, setQuery, useQuery } from '@/app/router'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Modal } from '@/ui/Modal'
import { Skeleton } from '@/ui/Skeleton'
import type { ImportRun } from './importPlan'

const ImportFlow = lazy(() => import('./ImportFlow').then((m) => ({ default: m.ImportFlow })))

export interface ImportGoalButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
}

/**
 * "Import from Claude" for the goals list: creates a NEW goal from pasted JSON in a dialog, then opens it
 * (BRIEF §5.4). Also opens itself for `?import=1`, which is how the palette command reaches it from anywhere.
 */
export function ImportGoalButton({ variant = 'secondary', size = 'md' }: ImportGoalButtonProps) {
  const [open, setOpen] = useState(false)
  const query = useQuery()

  // ?import=1 (from the palette command) opens the dialog; the flag is derived while rendering, then removed.
  const asked = query.import === '1'
  const [seen, setSeen] = useState(false)
  if (asked !== seen) {
    setSeen(asked)
    if (asked) setOpen(true)
  }
  useEffect(() => {
    if (asked) setQuery({ import: undefined })
  }, [asked])

  const onImported = (run: ImportRun): void => {
    setOpen(false)
    navigate('goal', { goalId: run.goalId })
  }
  // Undo removes a goal the page may be showing: go back to the list instead of a missing goal.
  const onUndone = (run: ImportRun): void => {
    if (window.location.pathname === href('goal', { goalId: run.goalId })) navigate('goals')
  }

  return (
    <>
      <Button variant={variant} size={size} iconLeft={<Sparkles />} onClick={() => setOpen(true)}>
        Import from Claude
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Import a goal from Claude"
        description="Turn a course outline into a goal with courses, units and a schedule."
        size="lg"
        closeOnScrim={false}
      >
        <ErrorBoundary
          fallback={(_error, reset) => (
            <EmptyState
              size="sm"
              icon={<Sparkles />}
              title="The import could not load"
              description="Nothing was changed. Try again, or reload the page."
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
              <div aria-busy="true" aria-label="Loading the import">
                <Skeleton variant="block" height={200} />
              </div>
            }
          >
            <ImportFlow target={{ kind: 'new' }} focusOnMount onImported={onImported} onUndone={onUndone} />
          </Suspense>
        </ErrorBoundary>
      </Modal>
    </>
  )
}
