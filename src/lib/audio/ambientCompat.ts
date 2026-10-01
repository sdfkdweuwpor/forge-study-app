/**
 * TEMPORARY (removed in Task 6): the old single-bed ambient API on top of the mixer, so the
 * feature files keep compiling until they are rewired. A bed is a one-layer mix at master 1.
 */
import { applyMix, isMixPlaying, playingLayers, stopMix } from './mixer'

export type AmbientKind = 'brown' | 'rain' | 'cafe'

const LAYER = { brown: 'noise', rain: 'rain', cafe: 'cafe' } as const

const mixFor = (kind: AmbientKind, volume: number) => ({
  music: { style: 'off' as const, volume: 0 },
  layers: { [LAYER[kind]]: volume },
  noiseColor: 'brown' as const,
  master: 1,
})

export async function startAmbient(kind: AmbientKind, volume: number): Promise<void> {
  await applyMix(mixFor(kind, volume))
}

export function setAmbientVolume(v: number): void {
  const kind = ambientKind()
  if (kind) void applyMix(mixFor(kind, v))
}

export async function stopAmbient(fadeMs = 600): Promise<void> {
  await stopMix(fadeMs)
}

export function isAmbientPlaying(): boolean {
  return isMixPlaying()
}

export function ambientKind(): AmbientKind | null {
  const l = playingLayers()[0]
  return l === 'noise' ? 'brown' : l === 'rain' || l === 'cafe' ? l : null
}
