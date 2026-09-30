/**
 * Toast queue state (pure, unit-tested). The provider owns one reducer; components only render it.
 *
 * - Items keep arrival order. At most `max` live items are visible; the rest wait in the queue and
 *   move up as visible ones are dismissed. Only visible items run an auto-dismiss timer.
 * - Dismissing a visible item marks it `leaving` (so it can animate out) and `remove` deletes it
 *   afterwards. Dismissing a queued item deletes it at once.
 * - Adding an item whose `id` already exists updates it in place (same slot) and bumps `revision`,
 *   which restarts its timer. Use a fixed id for status toasts such as "Saving…" then "Saved".
 * - Undo has its own lifecycle: idle → undoing → undone | undoFailed (Retry goes back to undoing,
 *   except after a refusal: an undo that found things changed since cannot succeed on a retry).
 */

/** Default number of toasts on screen at once. */
export const MAX_VISIBLE_TOASTS = 3

export type ToastVariant = 'default' | 'success' | 'error' | 'xp'

/** Same shape as `ToastButton` in ToastContext (kept here so the reducer has no React imports). */
export interface ToastActionButton {
  label: string
  onClick: () => void
}

export type UndoPhase = 'idle' | 'undoing' | 'undone' | 'undoFailed'

export interface ToastItem {
  id: string
  variant: ToastVariant
  title: string
  description?: string
  /** Auto-dismiss delay in ms while visible and not paused. 0 keeps the toast until dismissed. */
  duration: number
  /** Present when the toast offers an Undo button. */
  undo?: () => void | Promise<void>
  /** Present when the toast offers an action button ("Open"). */
  action?: ToastActionButton
  phase: UndoPhase
  /**
   * Why the undo was refused (things changed since), shown in place of "Try again". A refused undo
   * offers no Retry. Absent for an undo that simply failed.
   */
  undoRefusal?: string
  /** Exit animation running; removed shortly after. */
  leaving: boolean
  /** Bumped when the item is updated in place, to restart timers. */
  revision: number
}

export interface ToastState {
  items: readonly ToastItem[]
  /** How many toasts may be on screen at once; later ones wait in the queue. */
  max: number
}

export function createToastState(max: number = MAX_VISIBLE_TOASTS): ToastState {
  return { items: [], max: Math.max(1, Math.floor(max)) }
}

/** How long a toast stays, by kind. Errors and undoable toasts stay longer (WCAG 2.2.1). */
export const TOAST_DURATION = {
  default: 4000,
  success: 4000,
  xp: 4500,
  error: 7000,
  undo: 7000,
  /** The "Undone" confirmation. */
  undone: 2000,
  /** "Couldn't undo". */
  undoFailed: 5000,
} as const

/** Matches the exit animation in Toast.module.css (--dur-2), plus a little slack. */
export const TOAST_EXIT_MS = 220

export type ToastAction =
  | { type: 'add'; toast: Omit<ToastItem, 'phase' | 'leaving' | 'revision'> }
  | { type: 'dismiss'; id: string }
  | { type: 'dismissAll' }
  | { type: 'remove'; id: string }
  | { type: 'undoStart'; id: string }
  | { type: 'undoDone'; id: string }
  | { type: 'undoFailed'; id: string; refusal?: string }

/** Resolves the auto-dismiss delay: an explicit value wins, then undoable, then the variant default. */
export function resolveDuration(
  variant: ToastVariant,
  hasUndo: boolean,
  explicit?: number,
): number {
  if (explicit !== undefined) return Math.max(0, explicit)
  return hasUndo ? Math.max(TOAST_DURATION.undo, TOAST_DURATION[variant]) : TOAST_DURATION[variant]
}

function patch(
  state: ToastState,
  id: string,
  update: (item: ToastItem) => ToastItem | null,
): ToastState {
  const index = state.items.findIndex((item) => item.id === id)
  const current = state.items[index]
  if (current === undefined) return state
  const next = update(current)
  if (next === current) return state
  const items = state.items.slice()
  if (next === null) items.splice(index, 1)
  else items[index] = next
  return { ...state, items }
}

export function toastReducer(state: ToastState, action: ToastAction): ToastState {
  switch (action.type) {
    case 'add': {
      const existing = state.items.find((item) => item.id === action.toast.id)
      if (existing) {
        return patch(state, existing.id, (item) => ({
          ...item,
          ...action.toast,
          phase: 'idle',
          leaving: false,
          revision: item.revision + 1,
        }))
      }
      const item: ToastItem = { ...action.toast, phase: 'idle', leaving: false, revision: 0 }
      return { ...state, items: [...state.items, item] }
    }

    case 'dismiss': {
      const target = state.items.find((item) => item.id === action.id)
      if (!target) return state
      // Queued items were never shown: drop them without an exit animation.
      const queued = partitionToasts(state).queued.some((item) => item.id === action.id)
      return queued
        ? patch(state, action.id, () => null)
        : patch(state, action.id, (item) => (item.leaving ? item : { ...item, leaving: true }))
    }

    case 'dismissAll': {
      const { visible } = partitionToasts(state)
      return {
        ...state,
        items: visible.map((item) => (item.leaving ? item : { ...item, leaving: true })),
      }
    }

    case 'remove':
      return patch(state, action.id, () => null)

    case 'undoStart':
      return patch(state, action.id, (item) =>
        item.undo &&
        (item.phase === 'idle' || (item.phase === 'undoFailed' && item.undoRefusal === undefined)) &&
        !item.leaving
          ? { ...item, phase: 'undoing' }
          : item,
      )

    case 'undoDone':
      return patch(state, action.id, (item) =>
        item.phase === 'undoing'
          ? {
              ...item,
              phase: 'undone',
              duration: TOAST_DURATION.undone,
              revision: item.revision + 1,
            }
          : item,
      )

    case 'undoFailed':
      return patch(state, action.id, (item) =>
        item.phase === 'undoing'
          ? {
              ...item,
              phase: 'undoFailed',
              ...(action.refusal !== undefined ? { undoRefusal: action.refusal } : {}),
              duration: TOAST_DURATION.undoFailed,
              revision: item.revision + 1,
            }
          : item,
      )
  }
}

/**
 * Splits items into those on screen and those waiting. `leaving` items stay in `visible` (they are
 * still animating out) but free their slot immediately, so the next queued toast starts to enter.
 */
export function partitionToasts(state: ToastState): { visible: ToastItem[]; queued: ToastItem[] } {
  let slots = state.max
  const visible: ToastItem[] = []
  const queued: ToastItem[] = []
  for (const item of state.items) {
    if (item.leaving) {
      visible.push(item)
    } else if (slots > 0) {
      slots -= 1
      visible.push(item)
    } else {
      queued.push(item)
    }
  }
  return { visible, queued }
}
