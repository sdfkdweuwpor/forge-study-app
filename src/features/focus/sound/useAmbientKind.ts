import { useSyncExternalStore } from 'react'
import { ambientKind, subscribeAudio, type AmbientKind } from '@/lib/audio'

/** The ambient bed that is playing right now, or `null`. Only the old panel uses this (it imports the audio barrel). */
export function useAmbientKind(): AmbientKind | null {
  return useSyncExternalStore(subscribeAudio, ambientKind, () => null)
}
