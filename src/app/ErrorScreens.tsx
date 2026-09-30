import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { copyText } from '@/lib/clipboard'
import { isChunkLoadError } from '@/logic/chunkError'
import { buildErrorReport } from '@/logic/errorReport'
import { reloadOnceForChunkError } from './chunkReload'
import { exportAllData } from './exportData'
import type { FatalState } from './fatal'
import { getRecordedErrors } from './reportError'
import { href } from './router'
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
      // A note means something was left out (attached files over the size limit): say so, don't hide it.
      const left = r.notes.length > 0 ? ` ${r.notes.join(' ')}` : ''
      setState({ kind: 'done', text: `Saved ${r.filename} (${r.rows} records).${left}` })
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

/** The app's version (from package.json at build time), or "dev" where the build constant does not exist. */
const version = (): string => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev')

type CopyState = 'idle' | 'copied' | 'failed'

/** Copies what a bug report needs (the error, the page, the version and browser; nothing the person wrote). */
function CopyDetailsButton({ error, where }: { error: Error; where: string }) {
  const [state, setState] = useState<CopyState>('idle')

  async function run() {
    let ok = false
    try {
      const text = buildErrorReport({
        error: {
          name: error.name,
          message: error.message,
          ...(error.stack ? { stack: error.stack } : {}),
        },
        where,
        appVersion: version(),
        userAgent: navigator.userAgent,
        url: `${window.location.pathname}${window.location.search}`,
        at: Date.now(),
        recent: getRecordedErrors(),
      })
      ok = await copyText(text)
    } catch {
      ok = false
    }
    setState(ok ? 'copied' : 'failed')
  }

  return (
    <>
      <button type="button" className={styles.secondary} onClick={() => void run()}>
        Copy error details
      </button>
      <p className={styles.status} role="status">
        {state === 'copied'
          ? 'Copied. Paste it wherever you report the problem.'
          : state === 'failed'
            ? 'Couldn’t copy. Select the message above and copy it by hand.'
            : ''}
      </p>
    </>
  )
}

/**
 * Where an earlier copy of the data can be restored. A plain link, not the router's, so it works on a
 * screen that sits outside every provider; it reloads the app on that page, which is what a restore wants.
 */
function SnapshotsLink() {
  return (
    <p className={styles.help}>
      Something looks wrong with your data? Forge keeps a daily copy on this device.{' '}
      <a className={styles.link} href={href('settings', { section: 'snapshots' })}>
        Open Settings, Snapshots
      </a>{' '}
      to restore one.
    </p>
  )
}

const reload = () => window.location.reload()

/**
 * The last line of defence: if a crash screen itself throws (a bad message, a broken import), this shows
 * a plain page with the two things that always work, instead of leaving the person with a blank window.
 */
class CrashGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(_error: unknown, _info: ErrorInfo): void {
    // Nothing more to do: this screen must not depend on anything that could throw again.
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <main className={styles.screen}>
        <div className={styles.card} role="alert">
          <h1 className={styles.title}>Something went wrong</h1>
          <p className={styles.body}>
            Your data is stored on this device and has not been touched. Reload to try again.
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={reload}>
              Reload
            </button>
          </div>
        </div>
      </main>
    )
  }
}

interface FullScreenProps {
  title: string
  body: string
  /** Technical detail (the error message), shown in a quiet box. */
  detail?: string
  /** Re-renders the failed tree. When absent, Reload is the primary action. */
  onRetry?: () => void
  /** Offer a raw JSON export (needs the database to be readable). */
  canExport?: boolean
  /** The error behind the screen; adds "Copy error details". */
  error?: Error
  /** Where it happened, for the copied details. */
  where?: string
  /** Point at Settings, Snapshots (only where the app can still start). */
  snapshots?: boolean
}

/** Full-screen failure page. Uses no app context, so it survives provider failures. */
function FullScreenError({
  title,
  body,
  detail,
  onRetry,
  canExport = true,
  error,
  where = 'the app',
  snapshots = false,
}: FullScreenProps) {
  return (
    <CrashGuard>
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
            {error ? <CopyDetailsButton error={error} where={where} /> : null}
          </div>
          {snapshots ? <SnapshotsLink /> : null}
        </div>
      </main>
    </CrashGuard>
  )
}

/** Full-screen fallback for the root ErrorBoundary. */
export function RootErrorScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <FullScreenError
      title="Something went wrong"
      body="Forge hit an unexpected problem. Your data is stored on this device and has not been touched. Export a copy to be safe, then try again."
      detail={error.message}
      onRetry={onRetry}
      error={error}
      where="the app"
      snapshots
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
          error={fatal.error}
          where="start-up"
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
        <CopyDetailsButton error={error} where="a page" />
      </div>
      <SnapshotsLink />
    </section>
  )
}
