import { describe, expect, it } from 'vitest'
import {
  INITIAL_NAV_STATE,
  paletteNavReducer,
  resolveActive,
  type PaletteNavAction,
  type PaletteNavState,
} from './paletteNav'

const IDS = ['start-focus', 'new-task', 'task:c182-ch4', 'goal:c779']

function run(actions: PaletteNavAction[], from: PaletteNavState = INITIAL_NAV_STATE) {
  return actions.reduce(paletteNavReducer, from)
}

describe('resolveActive', () => {
  it('falls back to the first result before any interaction', () => {
    expect(resolveActive(INITIAL_NAV_STATE, IDS)).toBe('start-focus')
  })

  it('keeps a stored id that is still selectable', () => {
    expect(resolveActive({ activeId: 'new-task' }, IDS)).toBe('new-task')
  })

  it('falls back to the first result when the stored id disappeared', () => {
    expect(resolveActive({ activeId: 'gone' }, IDS)).toBe('start-focus')
  })

  it('is null for an empty list', () => {
    expect(resolveActive({ activeId: 'new-task' }, [])).toBeNull()
  })
})

describe('paletteNavReducer', () => {
  it('moves down from the implicit first row to the second', () => {
    expect(run([{ type: 'next', ids: IDS }]).activeId).toBe('new-task')
  })

  it('moves up from the implicit first row by wrapping to the last', () => {
    expect(run([{ type: 'prev', ids: IDS }]).activeId).toBe('goal:c779')
  })

  it('wraps from the last item to the first when going down', () => {
    const state = run([
      { type: 'hover', id: 'goal:c779' },
      { type: 'next', ids: IDS },
    ])
    expect(state.activeId).toBe('start-focus')
  })

  it('steps down and up through the list', () => {
    const down = run([
      { type: 'next', ids: IDS },
      { type: 'next', ids: IDS },
    ])
    expect(down.activeId).toBe('task:c182-ch4')
    expect(run([{ type: 'prev', ids: IDS }], down).activeId).toBe('new-task')
  })

  it('treats a stale active id as the first row, so the highlight and the next key agree', () => {
    const state = run([{ type: 'next', ids: IDS }], { activeId: 'removed-by-filtering' })
    expect(state.activeId).toBe('new-task')
  })

  it('does not skip disabled items because callers pass only selectable ids', () => {
    const selectable = ['start-focus', 'task:c182-ch4']
    expect(run([{ type: 'next', ids: selectable }]).activeId).toBe('task:c182-ch4')
  })

  it('stays on the only item and keeps the same state object', () => {
    const only = ['start-focus']
    const before = { activeId: 'start-focus' }
    expect(paletteNavReducer(before, { type: 'next', ids: only })).toBe(before)
  })

  it('clears the selection when the list is empty', () => {
    expect(run([{ type: 'next', ids: [] }], { activeId: 'new-task' })).toEqual(INITIAL_NAV_STATE)
    expect(run([{ type: 'prev', ids: [] }])).toBe(INITIAL_NAV_STATE)
  })

  it('selects the hovered item, ignoring repeated hovers of the same one', () => {
    const state = run([{ type: 'hover', id: 'task:c182-ch4' }])
    expect(state.activeId).toBe('task:c182-ch4')
    expect(paletteNavReducer(state, { type: 'hover', id: 'task:c182-ch4' })).toBe(state)
  })

  it('continues from the hovered item with the keyboard', () => {
    const state = run([
      { type: 'hover', id: 'new-task' },
      { type: 'next', ids: IDS },
    ])
    expect(state.activeId).toBe('task:c182-ch4')
  })

  it('goes back to the top result when the query changes', () => {
    const state = run([{ type: 'hover', id: 'goal:c779' }, { type: 'reset' }])
    expect(resolveActive(state, IDS)).toBe('start-focus')
  })
})
