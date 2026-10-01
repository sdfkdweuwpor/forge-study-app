/**
 * Lets a palette command ask "is there anything to undo?" without reaching into the toast provider, which
 * commands cannot see (`when` gets a `CommandCtx`, not React context). `UndoHost` sets the probe while it is
 * mounted, inside the provider; with no host mounted nothing can be undone.
 */
type Probe = () => boolean

const none: Probe = () => false
let probe: Probe = none

/** Installs `next` as the probe and returns the function that removes it again. */
export function setUndoProbe(next: Probe): () => void {
  probe = next
  return () => {
    if (probe === next) probe = none
  }
}

/** Whether a toast on screen offers an Undo right now. A probe that throws counts as nothing. */
export function canUndoNow(): boolean {
  try {
    return probe()
  } catch {
    return false
  }
}
