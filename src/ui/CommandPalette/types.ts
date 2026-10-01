import type { ReactNode } from 'react'

export interface PaletteItem {
  /** Unique across all groups. */
  id: string
  title: string
  subtitle?: string
  /** A 16px icon (lucide) or an emoji; decorative. */
  icon?: ReactNode
  /** Shortcut spec shown right-aligned as key caps: `'mod+k'`, `'g t'`, `'shift+s'` (see Kbd). */
  shortcut?: string
  /** Indices into `title` (UTF-16 code units) to emphasise, e.g. from the fuzzy matcher. */
  matches?: readonly number[]
  /** Same, for `subtitle`. */
  subtitleMatches?: readonly number[]
  /** Shown but cannot be chosen; arrow keys skip it. */
  disabled?: boolean
}

export interface PaletteGroup {
  id: string
  /** Group heading, e.g. "Recent", "Actions", "Tasks". */
  heading: string
  items: readonly PaletteItem[]
}
