import { useEffect } from 'react'
import { useToast, useToastUndo } from '@/ui/Toast'
import { useShortcutHandler } from './shortcuts'
import { setUndoProbe } from './undoProbe'

/** One toast for every press with nothing to undo: a repeated press updates it in place. */
const NOTHING_TO_UNDO_ID = 'app.undo.nothing'
/** Short and plain: it only says the key was heard. */
const NOTHING_TO_UNDO_MS = 2000

/**
 * `mod+z` (PLAN §5.2, "Undo last action"): presses the Undo button of the most recent toast that still
 * offers one, through the same path a click takes (`useToastUndo`), so "Undone", "Couldn’t undo" and a
 * refused undo look exactly as they do after a click. With nothing to undo it says so, quietly.
 *
 * The shortcut is global and not bound inside text fields (the field's own undo keeps the key), and it
 * goes quiet under a dialog or menu like every other global key. The palette's "Undo" command calls the
 * same handler through `invoke('app.undo')`, and is listed only while the probe below finds something.
 * Mounted through the `global.overlays` slot by the shell's own manifest.
 */
export function UndoHost() {
  const toast = useToast()
  const undo = useToastUndo()

  useEffect(() => setUndoProbe(undo.canUndo), [undo])

  useShortcutHandler('app.undo', () => {
    if (undo.undoLatest()) return
    toast.show({ id: NOTHING_TO_UNDO_ID, title: 'Nothing to undo', duration: NOTHING_TO_UNDO_MS })
  })

  return null
}
