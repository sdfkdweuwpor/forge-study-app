import { useCallback } from 'react'
import { dayOf } from '@/logic/dates'
import { useOverlays } from '../providers/OverlayProvider'
import type { CommandCtx } from '../registry/types'
import { navigate } from '../router'
import { useShortcuts } from '../shortcuts'

/** Builds the context commands and search results run with, fresh for each call. */
export function useCommandCtx(): () => CommandCtx {
  const overlays = useOverlays()
  const { invoke } = useShortcuts()
  return useCallback((): CommandCtx => {
    const now = Date.now()
    return { now, today: dayOf(now), navigate, overlays, invoke }
  }, [overlays, invoke])
}
