import type {
  LofiStyle,
  Mix,
  MixPreset,
  NoiseColor,
  NoiseLayer,
  Settings,
  SoundMixer,
} from '@/db/types'

export const LOFI_STYLES: readonly LofiStyle[] = [
  'classic',
  'rainy',
  'coffee',
  'tokyo',
  'synthwave',
  'electronic',
  'jazzhop',
  'piano',
  'chillhop',
  'space',
]
export const NOISE_LAYERS: readonly NoiseLayer[] = [
  'rain',
  'storm',
  'wind',
  'campfire',
  'cafe',
  'waves',
  'birds',
  'creek',
  'noise',
]

export const STYLE_LABELS: Record<LofiStyle, string> = {
  classic: 'Classic lofi',
  rainy: 'Rainy day',
  coffee: 'Coffee shop',
  tokyo: 'Tokyo night',
  synthwave: 'Synthwave',
  electronic: 'Electronic',
  jazzhop: 'Jazz hop',
  piano: 'Sleepy piano',
  chillhop: 'Chillhop morning',
  space: 'Space ambient',
}
export const LAYER_LABELS: Record<NoiseLayer, string> = {
  rain: 'Rain',
  storm: 'Heavy rain & thunder',
  wind: 'Wind',
  campfire: 'Campfire',
  cafe: 'Café chatter',
  waves: 'Ocean waves',
  birds: 'Forest birds',
  creek: 'Creek',
  noise: 'Noise',
}

export const MAX_PRESETS = 12
export const PRESET_NAME_MAX = 40

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {}
const vol = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback
const COLORS: readonly NoiseColor[] = ['white', 'pink', 'brown']

function cleanMix(raw: unknown): Mix {
  const r = obj(raw)
  const music = obj(r.music)
  const style = LOFI_STYLES.find((s) => s === music.style) ?? 'off'
  const rawLayers = obj(r.layers)
  const layers: Mix['layers'] = {}
  for (const l of NOISE_LAYERS) {
    const v = vol(rawLayers[l], 0)
    if (v > 0) layers[l] = v
  }
  return {
    music: { style, volume: vol(music.volume, 0.6) },
    layers,
    noiseColor: COLORS.find((c) => c === r.noiseColor) ?? 'brown',
    master: vol(r.master, 1),
  }
}

export function cleanMixer(raw: unknown): SoundMixer {
  const r = obj(raw)
  const presets: MixPreset[] = []
  for (const p of Array.isArray(r.presets) ? r.presets : []) {
    const o = obj(p)
    if (typeof o.id !== 'string' || typeof o.name !== 'string') continue
    const name = o.name.trim().slice(0, PRESET_NAME_MAX).trim()
    if (!name || presets.some((x) => x.id === o.id)) continue
    presets.push({ id: o.id, name, mix: cleanMix(o.mix) })
    if (presets.length === MAX_PRESETS) break
  }
  return { ...cleanMix(r), withFocus: r.withFocus !== false, presets }
}

/** The mixer in use: the stored one, or one derived from the older single-ambient fields. */
export function effectiveMixer(sound: Settings['sound']): SoundMixer {
  if (sound.mixer) return cleanMixer(sound.mixer)
  const layer = ({ brown: 'noise', rain: 'rain', cafe: 'cafe', none: undefined } as const)[
    sound.ambient
  ]
  return cleanMixer({
    layers: layer ? { [layer]: sound.ambientVolume } : {},
    noiseColor: 'brown',
  })
}

export const isSilent = (mix: Mix): boolean =>
  mix.music.style === 'off' && Object.keys(mix.layers).length === 0

export function describeLayers(mix: Mix): string {
  const parts = NOISE_LAYERS.flatMap((l) => {
    const v = mix.layers[l]
    return v ? [`${LAYER_LABELS[l]} ${Math.round(v * 100)}%`] : []
  })
  return parts.length ? parts.join(' · ') : 'Off'
}

const mixOf = ({ music, layers, noiseColor, master }: Mix): Mix =>
  structuredClone({ music, layers, noiseColor, master })

/** `name` made unique among the other presets: "Focus", "Focus 2", "Focus 3"… (still within the length limit). */
function uniqueName(presets: readonly MixPreset[], raw: string, selfId?: string): string {
  const base = raw.trim().slice(0, PRESET_NAME_MAX).trim()
  const taken = new Set(presets.filter((p) => p.id !== selfId).map((p) => p.name.toLowerCase()))
  let name = base
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const tail = ` ${n}`
    name = base.slice(0, PRESET_NAME_MAX - tail.length).trimEnd() + tail
  }
  return name
}

/** Adds the current mix as a preset. Returns `mixer` itself (unchanged) when the name is empty or 12 are saved. */
export function savePreset(mixer: SoundMixer, name: string, newId: () => string): SoundMixer {
  if (mixer.presets.length >= MAX_PRESETS || !name.trim()) return mixer
  const preset = { id: newId(), name: uniqueName(mixer.presets, name), mix: mixOf(mixer) }
  return { ...mixer, presets: [...mixer.presets, preset] }
}

export function renamePreset(mixer: SoundMixer, id: string, name: string): SoundMixer {
  if (!name.trim() || !mixer.presets.some((p) => p.id === id)) return mixer
  const next = uniqueName(mixer.presets, name, id)
  return { ...mixer, presets: mixer.presets.map((p) => (p.id === id ? { ...p, name: next } : p)) }
}

export const deletePreset = (mixer: SoundMixer, id: string): SoundMixer => ({
  ...mixer,
  presets: mixer.presets.filter((p) => p.id !== id),
})

/** Copies a preset's mix over the current one; `presets` and `withFocus` stay. */
export function applyPreset(mixer: SoundMixer, id: string): SoundMixer {
  const p = mixer.presets.find((x) => x.id === id)
  return p ? { ...mixer, ...mixOf(p.mix) } : mixer
}
