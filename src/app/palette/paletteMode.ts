import type { PaletteMode } from './paletteModel'

/**
 * How the next palette session should open. `/` asks for search mode (tasks, goals and pages, no
 * actions); every other way in gets the full palette. Read once when the session mounts, and put back
 * when it unmounts, so a stale request can never leak into a later open. Reading is pure (StrictMode
 * renders twice); only the reset writes.
 */
let requested: PaletteMode = 'all'

export function requestPaletteMode(mode: PaletteMode): void {
  requested = mode
}

export function getPaletteMode(): PaletteMode {
  return requested
}

export function resetPaletteMode(): void {
  requested = 'all'
}
