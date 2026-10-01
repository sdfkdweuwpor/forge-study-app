import { useCallback, useEffect, useRef, useState } from 'react'

/** Matches the Modal's exit animation (`--dur-2` plus slack), so the dialog leaves before it unmounts. */
const EXIT_MS = 240

/**
 * The life of one opening of a dialog: `open` starts true, `close()` turns it false (the Modal plays its
 * exit), and `onGone` runs once the exit has finished so the host can drop the component and its state.
 */
export function useDialogLifecycle(onGone: () => void): { open: boolean; close: () => void } {
  const [open, setOpen] = useState(true)
  const latest = useRef(onGone)
  useEffect(() => {
    latest.current = onGone
  })
  const close = useCallback(() => setOpen(false), [])
  useEffect(() => {
    if (open) return undefined
    const timer = window.setTimeout(() => latest.current(), EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [open])
  return { open, close }
}
