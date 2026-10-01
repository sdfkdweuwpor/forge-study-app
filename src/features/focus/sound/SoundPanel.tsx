import { useId } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import type { NoiseColor } from '@/db/types'
import { describeLayers, LAYER_LABELS, NOISE_LAYERS } from '@/logic/soundMix'
import { Button, Disclosure, SegmentedControl, Skeleton, useToast, type SegmentOption } from '@/ui'
import { audioAvailable, useMixer, useSoundDevice } from './hooks'
import { LoadBoundary } from './LoadBoundary'
import { resetLayers, setLayer, setMaster, setNoiseColor, setSectionOpen } from './mixActions'
import { togglePlay } from './playToggle'
import { Slider } from './Slider'
import styles from './SoundPanel.module.css'

const COLOR_OPTIONS: readonly SegmentOption<NoiseColor>[] = [
  { value: 'white', label: 'White' },
  { value: 'pink', label: 'Pink' },
  { value: 'brown', label: 'Brown' },
]

/**
 * The Focus page's Sound card (slot `focus.aside`): Play and the master volume, then collapsible
 * sections. Lofi and Mixes arrive in later tasks and show "Coming soon" until then. Which sections are
 * open is remembered on this device.
 */
export function SoundPanel() {
  return (
    <LoadBoundary what="the sound panel">
      <SoundPanelBody />
    </LoadBoundary>
  )
}

function SoundPanelBody() {
  const headingId = useId()
  const mix = useMixer()
  const device = useSoundDevice()
  const toast = useToast()

  const head = (
    <h2 id={headingId} className={styles.title}>
      Sound
    </h2>
  )

  if (!audioAvailable()) {
    return (
      <section className={styles.root} aria-labelledby={headingId}>
        {head}
        <p className={styles.note}>Sound isn’t available in this browser.</p>
      </section>
    )
  }
  if (!mix || !device) {
    return (
      <section className={styles.root} aria-labelledby={headingId} aria-busy="true">
        {head}
        <Skeleton variant="block" height={120} />
      </section>
    )
  }

  const { playing, open } = device

  async function reset() {
    try {
      const { undo } = await resetLayers()
      toast.show({ title: 'Sounds reset', undo })
    } catch {
      toast.error('Couldn’t reset the sounds. Try again.')
    }
  }

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <div className={styles.head}>
        {head}
        <Button
          size="sm"
          variant={playing ? 'secondary' : 'primary'}
          iconLeft={playing ? <Pause /> : <Play />}
          aria-pressed={playing}
          onClick={() => void togglePlay(playing)}
        >
          Play
        </Button>
      </div>
      <div className={styles.master}>
        <span className={styles.rowLabel}>Master</span>
        <Slider
          className={styles.slider}
          label="Master volume"
          value={mix.master}
          onValueChange={setMaster}
        />
      </div>

      <Disclosure title="Lofi" summary="Coming soon" disabled />

      <Disclosure
        title="Sounds"
        summary={describeLayers(mix)}
        open={open.sounds}
        onToggle={(o) => o !== open.sounds && void setSectionOpen('sounds', o)}
      >
        <ul className={styles.layers}>
          {NOISE_LAYERS.map((layer) => (
            <li key={layer} className={styles.layer}>
              <span className={styles.rowLabel} title={LAYER_LABELS[layer]}>
                {LAYER_LABELS[layer]}
              </span>
              <Slider
                className={styles.slider}
                label={LAYER_LABELS[layer]}
                value={mix.layers[layer] ?? 0}
                onValueChange={(v) => setLayer(layer, v)}
              />
              {layer === 'noise' && (
                <SegmentedControl
                  className={styles.color}
                  label="Noise colour"
                  size="sm"
                  options={COLOR_OPTIONS}
                  value={mix.noiseColor}
                  onValueChange={(c) => void setNoiseColor(c)}
                />
              )}
            </li>
          ))}
        </ul>
        <Button
          size="sm"
          variant="ghost"
          iconLeft={<RotateCcw />}
          className={styles.reset}
          onClick={() => void reset()}
        >
          Reset
        </Button>
      </Disclosure>

      <Disclosure title="Mixes" summary="Coming soon" disabled />
    </section>
  )
}
