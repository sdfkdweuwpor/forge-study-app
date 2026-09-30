/**
 * Thrown by an undo that found things changed since it was offered (the new task was edited, say), so
 * it left them as they are. The toast then reads "Couldn’t undo" with this message and offers no Retry,
 * since trying again would find the same change.
 */
export class UndoRefusedError extends Error {
  override name = 'UndoRefusedError'
}

export function isUndoRefused(error: unknown): error is UndoRefusedError {
  return error instanceof UndoRefusedError
}
