import type { SegmentOption } from '@/ui'
import type { AmbientSound } from '@/db/types'

/** The ambient choices, in the order they are shown. */
export const AMBIENT_OPTIONS: readonly SegmentOption<AmbientSound>[] = [
  { value: 'none', label: 'None' },
  { value: 'brown', label: 'Brown' },
  { value: 'rain', label: 'Rain' },
  { value: 'cafe', label: 'Café' },
]
