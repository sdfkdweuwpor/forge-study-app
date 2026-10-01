/**
 * Calm cover gradients (BRIEF §9: no purple or blue neon). The colours live in
 * PageHeader.module.css as `[data-preset='<id>']` rules; presets.test.ts checks that every id here
 * has a rule and that no colour drifts into the blue-violet range.
 */
export const COVER_PRESETS = [
  'warm-paper',
  'sage',
  'sand',
  'slate',
  'dusk-orange',
  'sea-glass',
  'stone',
  'ink',
] as const

export type CoverPresetId = (typeof COVER_PRESETS)[number]

export const COVER_PRESET_LABELS: Record<CoverPresetId, string> = {
  'warm-paper': 'Warm paper',
  sage: 'Sage',
  sand: 'Sand',
  slate: 'Slate',
  'dusk-orange': 'Dusk orange',
  'sea-glass': 'Sea glass',
  stone: 'Stone',
  ink: 'Ink',
}

export function isCoverPresetId(value: string): value is CoverPresetId {
  return (COVER_PRESETS as readonly string[]).includes(value)
}

/** What a page shows above its title. Structurally compatible with the stored gradient cover. */
export type PageCover =
  /** `preset` is a `CoverPresetId`; an unknown id renders as `stone`. */
  | { kind: 'gradient'; preset: string }
  /** `posY` is the vertical focal point, 0 (top) to 100 (bottom); default 50. */
  | { kind: 'image'; url: string; posY?: number }
