import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Bell, BellRing, Play, Square } from 'lucide-react'
import { updateSettings, type SettingsPatch } from '@/db/repos/settings'
import type { AmbientSound } from '@/db/types'
import {
  armAudioUnlock,
  isAmbientPlaying,
  playChime,
  setAmbientVolume,
  startAmbient,
  stopAmbient,
  unlockAudio,
} from '@/lib/audio'
import { notify, type NotifyPermission } from '@/lib/notify'
import { Button, SegmentedControl, Skeleton, Toggle } from '@/ui'
import { allowNotifications, setSoundsEnabled } from './actions'
import { useNotifyPermission, useSoundSettings } from './hooks'
import { useAmbientKind } from './useAmbientKind'
import { LoadBoundary } from './LoadBoundary'
import { AMBIENT_OPTIONS } from './options'
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
 * the default ambient bed with a preview button, and the notification permission.
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
  const playing = useAmbientKind()
  const permission = useNotifyPermission()
  const [message, setMessage] = useState<Message | null>(null)
  /** True when the Preview button, not a focus session, started the ambient bed. */
  const startedHere = useRef(false)

  // The audio context is only ever created for someone who has sounds on.
  const soundOn = settings?.sound.enabled === true
  useEffect(() => {
    if (soundOn) armAudioUnlock()
  }, [soundOn])
  useEffect(
    () => () => {
      if (startedHere.current && isAmbientPlaying()) void stopAmbient(300)
    },
    [],
  )

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

  function previewAmbient() {
    if (isAmbientPlaying()) {
      startedHere.current = false
      void stopAmbient()
      return
    }
    if (sound.ambient === 'none') return
    startedHere.current = true
    void startAmbient(sound.ambient, sound.ambientVolume)
  }

  function chooseDefault(kind: AmbientSound) {
    saveQuietly({ sound: { ambient: kind } })
    // If something is already sounding (a preview), follow the choice so it can be heard.
    if (!isAmbientPlaying()) return
    if (kind === 'none') {
      startedHere.current = false
      void stopAmbient()
    } else {
      void startAmbient(kind, sound.ambientVolume)
    }
  }

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
        label="Ambient sound"
        help="Plays quietly while you focus. Made on your device, nothing to download."
      >
        {() => (
          <>
            <SegmentedControl
              label="Ambient sound"
              size="sm"
              options={AMBIENT_OPTIONS}
              value={sound.ambient}
              disabled={off}
              onValueChange={chooseDefault}
            />
            <Button
              size="sm"
              iconLeft={playing ? <Square /> : <Play />}
              disabled={off || (playing === null && sound.ambient === 'none')}
              onClick={previewAmbient}
            >
              {playing ? 'Stop preview' : 'Preview'}
            </Button>
          </>
        )}
      </Row>

      <Row label="Ambient volume">
        {() => (
          <Slider
            label="Ambient volume"
            value={sound.ambientVolume}
            disabled={off}
            onValueChange={setAmbientVolume}
            onValueCommit={(v) => save({ sound: { ambientVolume: v } })}
          />
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
