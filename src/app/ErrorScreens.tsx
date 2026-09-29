import { useEffect, useState } from 'react'
import { isChunkLoadError } from '@/logic/chunkError'
import { reloadOnceForChunkError } from './chunkReload'
import { exportAllData } from './exportData'
import type { FatalState } from './fatal'
import styles from './ErrorScreens.module.css'

type ExportState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; text: string }
  | { kind: 'failed'; text: string }

function ExportButton() {
  const [state, setState] = useState<ExportState>({ kind: 'idle' })

  async function run() {
    setState({ kind: 'busy' })
    try {
      const r = await exportAllData()
      setState({ kind: 'done', text: `Saved ${r.filename} (${r.rows} records).` })
    } catch (e) {
      setState({
        kind: 'failed',
        text: `Could not read the database${e instanceof Error ? `: ${e.message}` : '.'}`,
      })
    }
  }

  return (
    <>
      <button
        type="button"
        className={styles.secondary}
        onClick={() => void run()}
        disabled={state.kind === 'busy'}
      >
        {state.kind === 'busy' ? 'Exporting…' : 'Export my data'}
      </button>
      <p className={styles.status} role="status">
        {state.kind === 'done' || state.kind === 'failed' ? state.text : ''}
      </p>
    </>
  )
}

const reload = () => window.location.reload()

interface FullScreenProps {
  title: string
  body: string
  /** Technical detail (the error message), shown in a quiet box. */
  detail?: string
  /** Re-renders the failed tree. When absent, Reload is the primary action. */
  onRetry?: () => void
  /** Offer a raw JSON export (needs the database to be readable). */
  canExport?: boolean
}

/** Full-screen failure page. Uses no app context, so it survives provider failures. */
function FullScreenError({ title, body, detail, onRetry, canExport = true }: FullScreenProps) {
  return (
    <main className={styles.screen}>
      <div className={styles.card} role="alert">
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.body}>{body}</p>
        {detail ? <p className={styles.detail}>{detail}</p> : null}
        <div className={styles.actions}>
          {onRetry ? (
            <>
              <button type="button" className={styles.primary} onClick={onRetry}>
                Try again
              </button>
              <button type="button" className={styles.secondary} onClick={reload}>
                Reload
              </button>
            </>
          ) : (
            <button type="button" className={styles.primary} onClick={reload}>
              Reload
            </button>
          )}
          {canExport ? <ExportButton /> : null}
        </div>
      </div>
    </main>
  )
}

/** Full-screen fallback for the root ErrorBoundary. */
export function RootErrorScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <FullScreenError
      title="Something went wrong"
      body="Forge hit an unexpected error. Your data is stored on this device and has not been touched. You can export a copy before you try again."
      detail={error.message}
      onRetry={onRetry}
    />
  )
}

/** Failures outside React: startup, a blocked database, another tab upgrading the schema. */
export function FatalScreen({ fatal }: { fatal: FatalState }) {
  switch (fatal.kind) {
    case 'db-stale':
      return (
        <FullScreenError
          title="Forge was updated in another tab"
          body="Reload this tab to continue with the latest version. Your data is safe on this device."
          canExport={false}
        />
      )
    case 'boot-timeout':
      return (
        <FullScreenError
          title="Forge is taking a while to start"
          body="The database on this device is not answering. Another Forge tab or window may be holding it: close the others, then reload. Your data has not been touched."
        />
      )
    case 'boot-failed':
      return (
        <FullScreenError
          title="Forge could not start"
          body="The database on this device could not be opened. Your data has not been touched. Reload to try again, or export a copy first."
          detail={fatal.error.message}
        />
      )
  }
}

/** Inline fallback when one page fails; the sidebar and the rest of the app keep working. */
export function RouteErrorView({ error, onRetry }: { error: Error; onRetry: () => void }) {
  // A lazy chunk that 404s after a deploy: reload once automatically; the button covers the rest.
  const outdated = isChunkLoadError(error)
  useEffect(() => {
    if (outdated) reloadOnceForChunkError()
  }, [outdated])

  if (outdated) {
    return (
      <section className={styles.route} role="alert">
        <h1 className={styles.title}>A new version of Forge is available</h1>
        <p className={styles.body}>
          This page could not load because Forge was updated. Reload to get the latest version. Your
          data has not been changed.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={reload}>
            Reload
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.route} role="alert">
      <h1 className={styles.title}>This page hit a problem</h1>
      <p className={styles.body}>Other pages should still work. Your data has not been changed.</p>
      <p className={styles.detail}>{error.message}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onRetry}>
          Try again
        </button>
        <ExportButton />
      </div>
    </section>
  )
}
