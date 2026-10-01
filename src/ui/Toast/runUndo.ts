import { isUndoRefused } from '@/logic/undo'
import type { ToastAction, ToastItem } from './toastReducer'

/**
 * Runs a toast's Undo and records how it went: `undoStart` while it runs, then `undoDone` ("Undone"),
 * or `undoFailed` ("Couldn’t undo", with Retry) when it throws, or `undoFailed` with the message and no
 * Retry when it throws an `UndoRefusedError` (things changed since). It never rejects.
 *
 * This is the one path to an Undo: the toast's button and the `mod+z` shortcut both come here, so the
 * two can never disagree about what a result looks like.
 */
export async function runUndo(
  item: Pick<ToastItem, 'id' | 'undo'>,
  dispatch: (action: ToastAction) => void,
): Promise<void> {
  const { id, undo } = item
  if (!undo) return
  dispatch({ type: 'undoStart', id })
  try {
    await undo()
    dispatch({ type: 'undoDone', id })
  } catch (error) {
    dispatch(
      isUndoRefused(error)
        ? { type: 'undoFailed', id, refusal: error.message }
        : { type: 'undoFailed', id },
    )
  }
}
