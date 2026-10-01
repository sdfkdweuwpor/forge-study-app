import { useSyncExternalStore } from 'react'
import { PREF_KEYS, readPref, subscribePrefs, writePref } from '@/lib/localPrefs'
import { ZOOMS, type Zoom } from '@/logic/roadmap'

const DEFAULT_ZOOM: Zoom = 6

function readZoom(): Zoom {
  const n = Number(readPref(PREF_KEYS.roadmapZoom))
  return ZOOMS.find((z) => z === n) ?? DEFAULT_ZOOM
}

export function setZoom(zoom: Zoom): void {
  writePref(PREF_KEYS.roadmapZoom, String(zoom))
}

/** The next zoom after the current one (3 → 6 → 12 → 3), saved. */
export function cycleZoom(): void {
  const at = ZOOMS.indexOf(readZoom())
  setZoom(ZOOMS[(at + 1) % ZOOMS.length] ?? DEFAULT_ZOOM)
}

/** The saved zoom in months (device-local, default 6) and a setter that saves it. */
export function useZoom(): [Zoom, (zoom: Zoom) => void] {
  const zoom = useSyncExternalStore(subscribePrefs, readZoom, () => DEFAULT_ZOOM)
  return [zoom, setZoom]
}
