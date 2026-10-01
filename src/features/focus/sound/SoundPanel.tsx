import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  AudioWaveform,
  CloudRain,
  Coffee,
  Cpu,
  MoreHorizontal,
  Moon,
  Music,
  Pause,
  Piano,
  Play,
  Plus,
  RotateCcw,
  Sailboat,
  Sunrise,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { LofiStyle, NoiseColor } from '@/db/types'

import {
  describeLayers,
  LAYER_LABELS,
  LOFI_STYLES,
  MAX_PRESETS,
  NOISE_LAYERS,
  PRESET_NAME_MAX,
  STYLE_LABELS,
} from '@/logic/soundMix'
import {
  Button,
  Disclosure,
  Dropdown,
  IconButton,
  Input,
  Modal,
  SegmentedControl,
  Skeleton,
  Toggle,
  useToast,
  type SegmentOption,
} from '@/ui'
import { audioAvailable, useMixer, useSoundDevice } from './hooks'
import { LoadBoundary } from './LoadBoundary'
import {
  applyMix,
  deleteMix,
  renameMix,
  resetLayers,
  saveCurrentMix,
  setLayer,
  setMaster,
  setMusicVolume,
  setNoiseColor,
  setSectionOpen,
  setStyle,
  setWithFocus,
} from './mixActions'
import { togglePlay } from './playToggle'
import { Slider } from './Slider'
import styles from './SoundPanel.module.css'

const COLOR_OPTIONS: readonly SegmentOption<NoiseColor>[] = [
  { value: 'white', label: 'White' },
  { value: 'pink', label: 'Pink' },
  { value: 'brown', label: 'Brown' },
]

const STYLE_LOOK: Record<LofiStyle, { icon: LucideIcon; mood: string }> = {
  classic: { icon: Music, mood: 'mellow' },
  rainy: { icon: CloudRain, mood: 'cozy' },
  coffee: { icon: Coffee, mood: 'warm' },
  tokyo: { icon: Zap, mood: 'neon' },
  synthwave: { icon: Sailboat, mood: 'retro' },
  electronic: { icon: Cpu, mood: 'bright' },
  jazzhop: { icon: AudioWaveform, mood: 'smooth' },
  piano: { icon: Piano, mood: 'soft' },
  chillhop: { icon: Sunrise, mood: 'fresh' },
  space: { icon: Moon, mood: 'drifting' },
}

/** Arrow keys (and Home/End) move the choice one card at a time, wrapping, like a native radio group. */
function moveStyle(e: KeyboardEvent<HTMLButtonElement>, index: number): void {
  if (e.altKey || e.ctrlKey || e.metaKey) return // Alt+Left is the browser's Back
  const last = LOFI_STYLES.length - 1
  const to =
    e.key === 'ArrowRight' || e.key === 'ArrowDown'
      ? (index + 1) % (last + 1)
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        ? (index + last) % (last + 1)
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? last
            : -1
  const style = LOFI_STYLES[to]
  if (!style) return
  e.preventDefault()
  void setStyle(style)
  e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[to]?.focus()
}

/**
 * The Focus page's Sound card (slot `focus.aside`): Play and the master volume, then collapsible
 * sections. Mixes holds saved mixes (chips; Save names one, up to 12). "Start sound with focus" sits at
 * the bottom. Which sections are
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
  /** The name dialog: saving the current mix, or renaming a saved one. */
  const [naming, setNaming] = useState<{ id?: string; name: string } | null>(null)

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

  async function submitName(e: FormEvent) {
    e.preventDefault()
    if (!naming || !naming.name.trim()) return
    try {
      if (naming.id) await renameMix(naming.id, naming.name)
      else if ((await saveCurrentMix(naming.name)) === 'full')
        toast.error(`You can keep ${MAX_PRESETS} mixes. Delete one first.`)
      setNaming(null)
    } catch {
      toast.error('Couldn’t save that. Try again.')
    }
  }

  async function remove(id: string, name: string) {
    try {
      const { undo } = await deleteMix(id)
      toast.show({ title: `Deleted “${name}”`, undo })
    } catch {
      toast.error('Couldn’t delete that mix. Try again.')
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
          {playing ? 'Pause' : 'Play'}
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

      <Disclosure
        title="Lofi"
        summary={
          mix.music.style === 'off'
            ? 'Off'
            : `${STYLE_LABELS[mix.music.style]} · ${Math.round(mix.music.volume * 100)}%`
        }
        open={open.lofi}
        onToggle={(o) => o !== open.lofi && void setSectionOpen('lofi', o)}
      >
        <div className={styles.lofiTop}>
          <Button
            size="sm"
            variant={mix.music.style === 'off' ? 'secondary' : 'ghost'}
            aria-pressed={mix.music.style === 'off'}
            onClick={() => void setStyle('off')}
          >
            Off
          </Button>
          <Slider
            className={styles.slider}
            label="Music volume"
            value={mix.music.volume}
            onValueChange={setMusicVolume}
          />
        </div>
        <div role="radiogroup" aria-label="Lofi style" className={styles.styles}>
          {LOFI_STYLES.map((style, i) => {
            const { icon: Icon, mood } = STYLE_LOOK[style]
            const checked = mix.music.style === style
            const tabStop = checked || (mix.music.style === 'off' && i === 0)
            return (
              <button
                key={style}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={tabStop ? 0 : -1}
                className={styles.card}
                onClick={() => void setStyle(style)}
                onKeyDown={(e) => moveStyle(e, i)}
              >
                <Icon size={16} aria-hidden="true" />
                <span className={styles.cardLabel}>{STYLE_LABELS[style]}</span>
                <span className={styles.mood}>{mood}</span>
              </button>
            )
          })}
        </div>
      </Disclosure>

      <Disclosure
        title="Sounds"
        summary={describeLayers(mix)}
        open={open.sounds}
        onToggle={(o) => o !== open.sounds && void setSectionOpen('sounds', o)}
      >
        <ul className={styles.layers}>
          {NOISE_LAYERS.map((layer) => (
            <li key={layer} className={styles.layer}>
              <span className={styles.layerLabel}>{LAYER_LABELS[layer]}</span>
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

      <Disclosure
        title="Mixes"
        summary={mix.presets.length ? `${mix.presets.length} saved` : 'None saved'}
        open={open.mixes}
        onToggle={(o) => o !== open.mixes && void setSectionOpen('mixes', o)}
      >
        {mix.presets.length > 0 && (
          <ul className={styles.chips}>
            {mix.presets.map((p) => (
              <li key={p.id} className={styles.chip}>
                <button
                  type="button"
                  className={styles.chipMain}
                  onClick={() => void applyMix(p.id)}
                >
                  {p.name}
                </button>
                <Dropdown
                  label={`${p.name} options`}
                  align="end"
                  trigger={(t) => (
                    <IconButton
                      {...t}
                      size="sm"
                      variant="ghost"
                      label={`${p.name} options`}
                      icon={<MoreHorizontal />}
                    />
                  )}
                  items={[
                    {
                      id: 'rename',
                      label: 'Rename…',
                      onSelect: () => setNaming({ id: p.id, name: p.name }),
                    },
                    { type: 'separator' },
                    {
                      id: 'delete',
                      label: 'Delete',
                      danger: true,
                      onSelect: () => void remove(p.id, p.name),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<Plus />}
          className={styles.reset}
          disabled={mix.presets.length >= MAX_PRESETS}
          onClick={() => setNaming({ name: '' })}
        >
          Save current mix…
        </Button>
        {mix.presets.length >= MAX_PRESETS && (
          <p className={styles.note}>That’s {MAX_PRESETS} mixes. Delete one to save another.</p>
        )}
      </Disclosure>

      <div className={styles.withFocus}>
        <Toggle
          size="sm"
          label="Start sound with focus"
          checked={mix.withFocus}
          onCheckedChange={(on) => void setWithFocus(on)}
        />
      </div>

      <Modal
        open={naming !== null}
        onClose={() => setNaming(null)}
        title={naming?.id ? 'Rename mix' : 'Save current mix'}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNaming(null)}>
              Cancel
            </Button>
            <Button type="submit" form="mix-name-form" disabled={!naming?.name.trim()}>
              Save
            </Button>
          </>
        }
      >
        <form id="mix-name-form" onSubmit={(e) => void submitName(e)}>
          <Input
            label="Name"
            data-autofocus
            maxLength={PRESET_NAME_MAX}
            value={naming?.name ?? ''}
            onChange={(e) => setNaming((n) => n && { ...n, name: e.target.value })}
          />
        </form>
      </Modal>
    </section>
  )
}
