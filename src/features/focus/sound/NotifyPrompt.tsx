import { useId, useState } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '@/ui'
import { allowNotifications, dismissNotifyPrompt } from './actions'
import { useNotifyPermission, useSoundSettings } from './hooks'
import { LoadBoundary } from './LoadBoundary'
import styles from './NotifyPrompt.module.css'

type Outcome = 'granted' | 'declined' | 'error' | null

/**
 * A one-time, quiet ask shown after the first completed focus session: "Get a soft ping when a
 * session ends, even in another tab." Allow asks the browser; Not now just closes it. Either way
 * `settings.notifications.promptedAt` is stamped, so it is never shown again (Settings keeps the
 * control). Renders nothing while settings load, when the browser has no notifications, when the
 * permission was already decided, or once it has been answered.
 *
 * Mount it where a finished session shows up: the `focus.afterSession` slot.
 */
export function NotifyPrompt() {
  return (
    <LoadBoundary what="the notification prompt">
      <NotifyPromptBody />
    </LoadBoundary>
  )
}

function NotifyPromptBody() {
  const titleId = useId()
  const settings = useSoundSettings()
  const permission = useNotifyPermission()
  const [busy, setBusy] = useState(false)
  // Kept in the component so the answer stays on screen after the setting hides the question.
  const [outcome, setOutcome] = useState<Outcome>(null)

  if (outcome === 'granted' || outcome === 'declined') {
    return (
      <p className={styles.thanks} role="status">
        {outcome === 'granted'
          ? 'Done. You’ll get a soft ping when a session ends.'
          : 'No problem. You can turn this on later in Settings.'}
      </p>
    )
  }

  const shouldAsk =
    settings !== undefined && settings.notifications.promptedAt === null && permission === 'default'
  if (!shouldAsk && outcome !== 'error') return null

  async function allow() {
    setBusy(true)
    try {
      const result = await allowNotifications()
      setOutcome(result === 'granted' ? 'granted' : 'declined')
    } catch {
      setOutcome('error')
    } finally {
      setBusy(false)
    }
  }

  async function notNow() {
    setOutcome(null)
    try {
      await dismissNotifyPrompt()
    } catch {
      setOutcome('error')
    }
  }

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <span className={styles.icon} aria-hidden="true">
        <Bell />
      </span>
      <div className={styles.body}>
        <p id={titleId} className={styles.title}>
          Get a soft ping when a session ends
        </p>
        <p className={styles.text}>
          Even if Forge is in another tab. One quiet notification, only when your timer finishes.
        </p>
        {outcome === 'error' && (
          <p className={styles.error} role="alert">
            Couldn’t save that. Try again.
          </p>
        )}
        <div className={styles.actions}>
          <Button variant="primary" size="sm" loading={busy} onClick={() => void allow()}>
            Allow
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void notNow()}>
            Not now
          </Button>
        </div>
      </div>
    </section>
  )
}
