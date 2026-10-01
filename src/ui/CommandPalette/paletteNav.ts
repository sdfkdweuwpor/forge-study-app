/**
 * Keyboard navigation for the command palette as a pure reducer (no React), so the rules are
 * unit-tested. `ids` is always the selectable (enabled) item ids in visual order, flattened across
 * groups. The stored `activeId` may be stale after the results change; every read goes through
 * `resolveActive`, so the highlighted row and the next arrow key always agree.
 */

export interface PaletteNavState {
  /** The last id the user moved to or hovered, or null before any interaction. */
  activeId: string | null
}

export const INITIAL_NAV_STATE: PaletteNavState = { activeId: null }

export type PaletteNavAction =
  /** Arrow down (or Ctrl+N): next item, wrapping from the last to the first. */
  | { type: 'next'; ids: readonly string[] }
  /** Arrow up (or Ctrl+P): previous item, wrapping from the first to the last. */
  | { type: 'prev'; ids: readonly string[] }
  /** Pointer moved over an item. */
  | { type: 'hover'; id: string }
  /** The query changed: the top result becomes active again. */
  | { type: 'reset' }

/** The active id to show: the stored one while it is still selectable, else the first result. */
export function resolveActive(state: PaletteNavState, ids: readonly string[]): string | null {
  if (state.activeId !== null && ids.includes(state.activeId)) return state.activeId
  return ids[0] ?? null
}

export function paletteNavReducer(
  state: PaletteNavState,
  action: PaletteNavAction,
): PaletteNavState {
  switch (action.type) {
    case 'next':
    case 'prev': {
      const { ids } = action
      if (ids.length === 0) return state.activeId === null ? state : INITIAL_NAV_STATE
      const current = resolveActive(state, ids)
      const at = current === null ? -1 : ids.indexOf(current)
      const step = action.type === 'next' ? 1 : -1
      const to = ids[(at + step + ids.length) % ids.length] ?? null
      return to === state.activeId ? state : { activeId: to }
    }
    case 'hover':
      return action.id === state.activeId ? state : { activeId: action.id }
    case 'reset':
      return state.activeId === null ? state : INITIAL_NAV_STATE
  }
}
