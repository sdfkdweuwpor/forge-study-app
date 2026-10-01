import { useEffect, useId, useState, type ReactNode } from 'react'
import { Bell, BellRing } from 'lucide-react'
import { Link } from '@/app/router'
import { updateSettings, type SettingsPatch } from '@/db/repos/settings'
import { armAudioUnlock, playChime, unlockAudio } from '@/lib/audio'
import { notify, type NotifyPermission } from '@/lib/notify'
import { Button, Skeleton, Toggle } from '@/ui'
import { allowNotifications, setSoundsEnabled } from './actions'
import { useNotifyPermission, useSoundSettings } from './hooks'
import { LoadBoundary } from './LoadBoundary'
import { Slider } from './Slider'
import styles from './sound.module.css'

interface Message {
  kind: 'info' | 'error'
  text: string
}

const PERMISSION_LABEL: Record<NotifyPermission, string> = {
  granted: 'Allowed',
  denied: 'Blocked',
  default: 'Not asked yet',
  unsupported: 'Not available',
}

/**
 * Settings section (slot `settings.sections`): sounds on/off, chime volume with a live preview,
 * a link to the Sound panel, and the notification permission.
 */
export function SoundSection() {
  return (
    <LoadBoundary what="sound settings">
      <SoundSectionBody />
    </LoadBoundary>
  )
}

function SoundSectionBody() {
  const headingId = useId()
  const settings = useSoundSettings()
  const permission = useNotifyPermission()
  const [message, setMessage] = useState<Message | null>(null)

  // The audio context is only ever created for someone who has sounds on.
  const soundOn = settings?.sound.enabled === true
  useEffect(() => {
    if (soundOn) armAudioUnlock()
  }, [soundOn])

  async function save(patch: SettingsPatch): Promise<void> {
    try {
      await updateSettings(patch)
      setMessage(null)
    } catch (e) {
      setMessage({ kind: 'error', text: 'Couldn’t save that. Try again.' })
      throw e
    }
  }

  /** Runs a save from a control that has nothing to roll back (a toggle, a segmented control). */
  function saveQuietly(patch: SettingsPatch): void {
    save(patch).catch(() => undefined)
  }

  if (settings === undefined) {
    return (
      <section className={styles.section} aria-labelledby={headingId}>
        <h2 id={headingId} className={styles.heading}>
          Sound and notifications
        </h2>
        <div className={styles.loading} role="status" aria-label="Loading sound settings">
          <Skeleton variant="block" height={44} />
          <Skeleton variant="block" height={44} />
          <Skeleton variant="block" height={44} />
        </div>
      </section>
    )
  }

  const { sound, notifications } = settings
  const off = !sound.enabled

  async function sendTest() {
    const shown = await notify('Forge', 'A session ended. This is what the ping looks like.', {
      force: true,
      tag: 'forge-test',
    })
    setMessage(
      shown
        ? { kind: 'info', text: 'Sent. Look near the edge of your screen.' }
        : {
            kind: 'error',
            text: 'The browser didn’t show it. Check that notifications aren’t muted by your system (Do Not Disturb or Focus).',
          },
    )
  }

  async function allow() {
    try {
      const result = await allowNotifications()
      setMessage(
        result === 'granted'
          ? { kind: 'info', text: 'Done. You’ll get a ping when a session ends.' }
          : { kind: 'info', text: 'No notifications, then. You can change this here any time.' },
      )
    } catch {
      setMessage({ kind: 'error', text: 'Couldn’t save that. Try again.' })
    }
  }

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        Sound and notifications
      </h2>

      <Row label="Sounds" help="The chime and ambient sound. Off silences all of it.">
        {(labelledBy) => (
          <Toggle
            checked={sound.enabled}
            aria-labelledby={labelledBy}
            onCheckedChange={(enabled) => {
              // Sound has to start inside the click, so unlock before the database write.
              if (enabled) void unlockAudio()
              setSoundsEnabled(enabled).catch(() =>
                setMessage({ kind: 'error', text: 'Couldn’t save that. Try again.' }),
              )
            }}
          />
        )}
      </Row>

      <Row label="Chime when a session ends" help="A soft three-note bell.">
        {(labelledBy) => (
          <Toggle
            checked={sound.chime}
            disabled={off}
            aria-labelledby={labelledBy}
            onCheckedChange={(chime) => saveQuietly({ sound: { chime } })}
          />
        )}
      </Row>

      <Row label="Volume" help="Moving it plays the chime at that level.">
        {() => (
          <Slider
            label="Chime volume"
            value={sound.volume}
            disabled={off}
            onValueCommit={async (v) => {
              // Play first, inside the gesture; the save can follow.
              void playChime(v)
              await save({ sound: { volume: v } })
            }}
          />
        )}
      </Row>

      <Row
        label="Ambient sound and lofi"
        help="Rain, wind, café chatter and more, mixed to taste. Made on your device, nothing to download."
      >
        {() => (
          <Link to="focus" className={styles.link}>
            Open the Sound panel
          </Link>
        )}
      </Row>

      <Row
        label={
          <>
            Notifications
            <span className={styles.state} data-state={permission}>
              {PERMISSION_LABEL[permission]}
            </span>
          </>
        }
        help={notificationHelp(permission)}
      >
        {(labelledBy) => {
          if (permission === 'default') {
            return (
              <Button variant="primary" size="sm" iconLeft={<Bell />} onClick={() => void allow()}>
                Allow notifications
              </Button>
            )
          }
          if (permission === 'granted') {
            return (
              <>
                <Toggle
                  checked={notifications.enabled}
                  aria-labelledby={labelledBy}
                  onCheckedChange={(enabled) => saveQuietly({ notifications: { enabled } })}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  iconLeft={<BellRing />}
                  onClick={() => void sendTest()}
                >
                  Send a test
                </Button>
              </>
            )
          }
          return null
        }}
      </Row>

      <p
        className={styles.message}
        data-kind={message?.kind}
        role={message?.kind === 'error' ? 'alert' : 'status'}
      >
        {message?.text}
      </p>
    </section>
  )
}

function notificationHelp(permission: NotifyPermission): string {
  switch (permission) {
    case 'default':
      return 'Get a soft ping when a session ends, even if Forge is in another tab. Your browser will ask once.'
    case 'granted':
      return 'A ping when a session ends and Forge isn’t the window in front.'
    case 'denied':
      return 'Blocked in this browser. To turn them on, open the site settings from the lock icon next to the address bar, set Notifications to Allow, then reload this page.'
    case 'unsupported':
      return 'This browser can’t show notifications. The chime and the in-app message still work.'
  }
}

interface RowProps {
  label: ReactNode
  help?: string
  /** Receives the id of the label, for `aria-labelledby` on the control. */
  children: (labelId: string) => ReactNode
}

function Row({ label, help, children }: RowProps) {
  const labelId = useId()
  return (
    <div className={styles.row}>
      <div className={styles.text}>
        <span id={labelId} className={styles.label}>
          {label}
        </span>
        {help && <p className={styles.help}>{help}</p>}
      </div>
      <div className={styles.control}>{children(labelId)}</div>
    </div>
  )
}
