import { useState } from 'react'
import { exportAllData } from './exportData'
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

/** Full-screen fallback for the root ErrorBoundary. Uses no app context, so it survives provider failures. */
export function RootErrorScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <main className={styles.screen} role="alert">
      <div className={styles.card}>
        <h1 className={styles.title}>Something went wrong</h1>
        <p className={styles.body}>
          Forge hit an unexpected error. Your data is stored on this device and has not been
          touched. You can export a copy before you try again.
        </p>
        <p className={styles.detail}>{error.message}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={onRetry}>
            Try again
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
          <ExportButton />
        </div>
      </div>
    </main>
  )
}

/** Inline fallback when one page fails; the sidebar and the rest of the app keep working. */
export function RouteErrorView({ error, onRetry }: { error: Error; onRetry: () => void }) {
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
