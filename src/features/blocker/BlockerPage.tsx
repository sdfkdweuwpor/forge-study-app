/**
 * `/blocker`: the site blocker's control room (BRIEF §5.8). The extension does the blocking; this page
 * tells it what to block and when, and shows what it has done for you. Sections, top to bottom: the
 * extension's connection, today's wins, when to block, the blocked sites, exceptions and the
 * motivation lines. `?add=1` (the palette's "Add site to blocklist") and `a` focus the add field.
 */
import { Plus } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { Slot } from '@/app/registry'
import { setQuery, useQuery } from '@/app/router'
import { useShortcutHandler, useShortcutScope } from '@/app/shortcuts'
import { Button } from '@/ui/Button'
import { Kbd } from '@/ui/Kbd'
import { AllowlistSection } from './AllowlistSection'
import { BlocklistSection } from './BlocklistSection'
import { ConnectionSection } from './ConnectionSection'
import { MotivationSection } from './MotivationSection'
import { ModeSection } from './ModeSection'
import { SectionError } from './Section'
import { WinsSection } from './WinsSection'
import styles from './BlockerPage.module.css'

function Header({ onAdd }: { onAdd: () => void }) {
  return (
    <header className={styles.header}>
      <div className={styles.headText}>
        <h1 className={styles.heading}>Blocker</h1>
        <p className={styles.lead}>Keep distracting sites out of the way while you study.</p>
      </div>
      <Button
        variant="secondary"
        iconLeft={<Plus />}
        iconRight={<Kbd keys="a" size="sm" />}
        onClick={onAdd}
      >
        Add site
      </Button>
    </header>
  )
}

function BlockerScreen() {
  const input = useRef<HTMLInputElement | null>(null)
  const addRequested = useQuery().add === '1'

  const focusAdd = useCallback(() => {
    const el = input.current
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    el.focus()
  }, [])

  useShortcutScope('blocker')
  useShortcutHandler('blocker.addSite', focusAdd)

  // The palette's "Add site to blocklist" arrives as `?add=1`: focus the field, then drop the flag.
  useEffect(() => {
    if (!addRequested) return
    focusAdd()
    setQuery({ add: undefined })
  }, [addRequested, focusAdd])

  return (
    <div className={styles.root}>
      <Header onAdd={focusAdd} />
      <ConnectionSection />
      <WinsSection />
      <ModeSection />
      <BlocklistSection inputRef={input} />
      <AllowlistSection />
      <MotivationSection />
      <Slot id="blocker.sections" />
    </div>
  )
}

export default function BlockerPage() {
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <div className={styles.root}>
          <Header onAdd={() => undefined} />
          <SectionError what="the blocker" onRetry={reset} />
        </div>
      )}
    >
      <BlockerScreen />
    </ErrorBoundary>
  )
}
