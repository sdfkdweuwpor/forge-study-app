import type { Block } from '@/logic/blocks'
import { docHash } from './docHash'

/** How many of its own recent states the editor remembers, to tell an echo from an outside change. */
export const RECENT = 200

/**
 * What the editor knows about its document. `doc` is what is on screen; the parent's `value` may
 * trail it (a debounced save handed back late), so `value` only replaces `doc` when it is news.
 */
export interface EditorModel {
  doc: readonly Block[]
  /** The last `value` prop looked at. */
  seen: readonly Block[]
  /** Fingerprints of documents this editor produced lately. */
  recent: readonly number[]
  /** Bumps whenever `value` replaced the document; undo history does not survive that. */
  epoch: number
}

/**
 * `recent` starts with the first document's own fingerprint: a parent that re-renders before its
 * debounced save lands hands that same initial `value` back, and it must not read as news.
 */
export function initialModel(value: readonly Block[]): EditorModel {
  return { doc: value, seen: value, recent: [docHash(value)], epoch: 0 }
}

/**
 * The model after the parent passed `value`. The same content (a controlled parent handing an
 * edit back, whatever its object identity), or one of the editor's own recent states (a late
 * echo of an older save), changes nothing on screen. Anything else is an outside change (another
 * page, a restore) and replaces the document.
 */
export function reconcile(model: EditorModel, value: readonly Block[]): EditorModel {
  if (value === model.seen) return model
  const incoming = docHash(value)
  if (incoming === docHash(model.doc) || model.recent.includes(incoming)) {
    return { ...model, seen: value }
  }
  // The adopted value is the new starting point, so a parent that hands it back again after an edit
  // is not mistaken for a second outside change (which would replace the doc and wipe undo).
  return { doc: value, seen: value, recent: [incoming], epoch: model.epoch + 1 }
}

/** The model after an edit produced `doc`. Passing it straight back as `value` is then free. */
export function edited(model: EditorModel, doc: readonly Block[]): EditorModel {
  return {
    doc,
    seen: doc,
    recent: [...model.recent, docHash(doc)].slice(-RECENT),
    epoch: model.epoch,
  }
}
