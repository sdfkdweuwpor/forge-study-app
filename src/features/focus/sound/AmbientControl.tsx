import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { updateSettings } from '@/db/repos/settings'
import type { AmbientSound } from '@/db/types'
import { armAudioUnlock, isAmbientPlaying, setAmbientVolume, unlockAudio } from '@/lib/audio'
import { Button, IconButton, SegmentedControl, Skeleton } from '@/ui'
import { chooseAmbient, setSoundsEnabled, stopPreview, toggleAmbient } from './actions'
import { useAmbientKind, useSoundSettings } from './hooks'
import { LoadBoundary } from './LoadBoundary'
import { AMBIENT_OPTIONS } from './options'
import { Slider } from './Slider'
import styles from './AmbientControl.module.css'

export interface AmbientControlProps {
  className?: string
}

/**
 * The Focus page's ambient sound control: None / Brown / Rain / Café, a play-pause button and a
 * volume. Picking a sound plays it at once (so the choice is heard) and makes it the default for
 * sessions. Place it in the Focus page or its `focus.aside` slot.
 */
export function AmbientControl(props: AmbientControlProps) {
  return (
    <LoadBoundary what="ambient sound">
      <AmbientControlBody {...props} />
    </LoadBoundary>
  )
}

function AmbientControlBody({ className }: AmbientControlProps) {
  const settings = useSoundSettings()
  const playing = useAmbientKind()
  const [error, setError] = useState(false)

  // The audio context is only ever created for someone who has sounds on.
  const soundOn = settings?.sound.enabled === true
  useEffect(() => {
    if (soundOn) armAudioUnlock()
  }, [soundOn])

  // A bed tried out here (picked, or played with the button) stops when the control goes away, unless a
  // focus session is running: that one plays its own bed, and one that was already playing when this
  // opened is not ours to stop.
  const playingAtMount = useRef(isAmbientPlaying())
  useEffect(
    () => () => {
      if (!playingAtMount.current) stopPreview()
    },
    [],
  )

  const root = className ? `${styles.root} ${className}` : styles.root

  if (settings === undefined) {
    return (
      <div className={root} role="status" aria-label="Loading ambient sound">
        <Skeleton variant="block" height={28} />
        <Skeleton variant="block" height={32} />
      </div>
    )
  }

  const { sound } = settings

  if (!sound.enabled) {
    return (
      <div className={root}>
        <span className={styles.label}>Ambient sound</span>
        <p className={styles.hint}>Sounds are off.</p>
        <Button
          size="sm"
          onClick={() => {
            void unlockAudio()
            setSoundsEnabled(true).catch(() => setError(true))
          }}
        >
          Turn sounds on
        </Button>
        {error && (
          <p className={styles.error} role="alert">
            Couldn’t save that. Try again.
          </p>
        )}
      </div>
    )
  }

  const canPlay = sound.ambient !== 'none'

  return (
    <div className={root}>
      <div className={styles.head}>
        <span className={styles.label}>Ambient sound</span>
        {canPlay && (
          <IconButton
            label="Play ambient sound"
            icon={playing ? <Pause /> : <Play />}
            shortcut="a"
            pressed={playing !== null}
            onClick={() => void toggleAmbient()}
          />
        )}
      </div>
      <SegmentedControl
        label="Ambient sound"
        size="sm"
        fullWidth
        options={AMBIENT_OPTIONS}
        value={sound.ambient}
        onValueChange={(kind: AmbientSound) => {
          setError(false)
          chooseAmbient(kind, sound.ambientVolume).catch(() => setError(true))
        }}
      />
      <Slider
        className={styles.slider}
        label="Ambient volume"
        value={sound.ambientVolume}
        disabled={!canPlay}
        onValueChange={setAmbientVolume}
        onValueCommit={(v) => updateSettings({ sound: { ambientVolume: v } }).then(() => undefined)}
      />
      {error && (
        <p className={styles.error} role="alert">
          Couldn’t save that. Try again.
        </p>
      )}
    </div>
  )
}
