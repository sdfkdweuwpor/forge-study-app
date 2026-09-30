import { lazy, Suspense, useEffect, useId, useState, useSyncExternalStore } from 'react'
import { navigate, useQuery } from '@/app/router'
import { useSyncState, type SyncStateView } from '@/db/hooks/useSyncState'
import { parseLinkReturn } from '@/logic/syncLink'
import { sectionState } from '@/logic/syncStatus'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Skeleton'
import { Spinner } from '@/ui/Spinner'
import { clearLinkMessage, getLinkState, handleLinkReturn, subscribeLinkState } from './linkReturn'
import { CopySqlButton, SetupForm, SetupGuideLink } from './SetupForm'
import { SignIn } from './SignIn'
import { SyncLimits } from './SyncLimits'
import styles from './SyncSection.module.css'

// What sync does once it is on is not needed to show the section, and stays unloaded until it is.
const SyncStatus = lazy(() => import('./SyncStatus').then((m) => ({ default: m.SyncStatus })))

function Loading() {
  return (
    <div className={styles.loading} role="status" aria-label="Loading sync settings">
      <Skeleton variant="block" height={44} />
      <Skeleton variant="block" height={44} />
    </div>
  )
}

/** `abcdefghijklmnopqrst.supabase.co`: the project, without the key and without the scheme. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Off, nothing saved: what sync is, and the way in. */
function Intro({ onStart }: { onStart: () => void }) {
  return (
    <div className={styles.body}>
      <p className={styles.lead}>
        Keep Forge the same on your laptop and phone, through your own free Supabase project. Forge
        works fully without it.
      </p>
      <div className={styles.actions}>
        <Button variant="primary" onClick={onStart}>
          Set up sync
        </Button>
        <SetupGuideLink />
      </div>
    </div>
  )
}

/** Off, a project saved: the project line, then the email step (or waiting for the email). */
function Connected({ view, onChange }: { view: SyncStateView; onChange?: () => void }) {
  return (
    <div className={styles.body}>
      <p className={styles.project}>
        <span className={styles.projectLabel}>Project</span>
        <span className={styles.host}>{hostOf(view.url ?? '')}</span>
        {onChange ? (
          <Button size="sm" variant="ghost" onClick={onChange}>
            Change project
          </Button>
        ) : null}
      </p>
      {view.pendingLogin === null ? (
        <p className={styles.lead}>
          Sign in with the email you use for this project. Forge sends a link and a code; there is no
          password.
        </p>
      ) : null}
      <SignIn view={view} />
      {view.pendingLogin === null ? (
        <div className={styles.actions}>
          <CopySqlButton variant="ghost" />
        </div>
      ) : null}
    </div>
  )
}

function Body({ view }: { view: SyncStateView | null }) {
  const [setupOpen, setSetupOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const saved = view?.url && view.anonKey ? { url: view.url, anonKey: view.anonKey } : null
  const state = view === null ? 'notSetUp' : sectionState(view)

  if (state === 'notSetUp' || view === null) {
    return setupOpen ? (
      <SetupForm initial={saved} onCancel={() => setSetupOpen(false)} />
    ) : (
      <Intro onStart={() => setSetupOpen(true)} />
    )
  }
  if (state === 'configured') {
    return editing ? (
      <SetupForm initial={saved} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
    ) : (
      <Connected view={view} onChange={() => setEditing(true)} />
    )
  }
  if (state === 'waiting') return <Connected view={view} />
  return (
    <Suspense fallback={<Loading />}>
      <SyncStatus view={view} />
    </Suspense>
  )
}

/**
 * Settings → Sync (contribution id `sync`, slot `settings.sections`). Off by default: one sentence and a
 * button. Everything past that (the form, the sign-in, the status) is its own piece, and the part that
 * runs while sync is on is loaded only then. A sign-in link that lands here (`?code=…`) is exchanged, the
 * address loses the code, and the section shows the first sync.
 */
export function SyncSection() {
  const headingId = useId()
  const view = useSyncState()
  const query = useQuery()
  const link = useSyncExternalStore(subscribeLinkState, getLinkState, getLinkState)

  useEffect(() => {
    const returned = parseLinkReturn(query, window.location.hash)
    if (returned === null) return
    // The address first, so a reload or a shared link never repeats it; then the exchange.
    navigate('settings', { section: 'sync' }, { replace: true })
    handleLinkReturn(returned)
  }, [query])

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        Sync
      </h2>
      {link.working ? (
        <p className={styles.progress} role="status">
          <Spinner size={16} />
          <span>Signing you in…</span>
        </p>
      ) : null}
      {link.message !== null ? (
        <div className={styles.notice} data-tone="attention" role="alert">
          <span>{link.message}</span>
          <Button size="sm" variant="ghost" onClick={clearLinkMessage}>
            Dismiss
          </Button>
        </div>
      ) : null}
      {view === undefined ? <Loading /> : <Body view={view} />}
      {view === undefined ? null : <SyncLimits />}
    </section>
  )
}
