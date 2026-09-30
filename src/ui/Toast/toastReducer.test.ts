import { describe, expect, it, vi } from 'vitest'
import {
  TOAST_DURATION,
  createToastState,
  partitionToasts,
  resolveDuration,
  toastReducer,
  type ToastAction,
  type ToastState,
} from './toastReducer'

type NewToast = Extract<ToastAction, { type: 'add' }>['toast']

const toast = (id: string, extra: Partial<NewToast> = {}): NewToast => ({
  id,
  variant: 'default',
  title: `Toast ${id}`,
  duration: 4000,
  ...extra,
})

const run = (actions: ToastAction[], from: ToastState = createToastState(3)): ToastState =>
  actions.reduce(toastReducer, from)

const add = (id: string, extra?: Partial<NewToast>): ToastAction => ({
  type: 'add',
  toast: toast(id, extra),
})

const ids = (state: ToastState): string[] => state.items.map((item) => item.id)

describe('toastReducer: add', () => {
  it('appends in arrival order with idle defaults', () => {
    const state = run([add('a'), add('b')])
    expect(ids(state)).toEqual(['a', 'b'])
    expect(state.items[0]).toMatchObject({ phase: 'idle', leaving: false, revision: 0 })
  })

  it('keeps an action button on the item', () => {
    const onClick = () => undefined
    const state = run([add('a', { action: { label: 'Open', onClick } })])
    expect(state.items[0]?.action).toEqual({ label: 'Open', onClick })
  })

  it('updates an existing id in place and restarts its timer', () => {
    const state = run([
      add('sync', { title: 'Saving…', duration: 0 }),
      add('other'),
      add('sync', { title: 'Saved', variant: 'success', duration: 4000 }),
    ])
    expect(ids(state)).toEqual(['sync', 'other'])
    expect(state.items[0]).toMatchObject({
      title: 'Saved',
      variant: 'success',
      duration: 4000,
      revision: 1,
    })
  })

  it('revives a leaving toast when the same id is added again', () => {
    const state = run([add('a'), { type: 'dismiss', id: 'a' }, add('a')])
    expect(state.items[0]).toMatchObject({ leaving: false, revision: 1 })
  })
})

describe('toastReducer: dismiss and remove', () => {
  it('marks a visible toast as leaving instead of deleting it', () => {
    const state = run([add('a'), { type: 'dismiss', id: 'a' }])
    expect(state.items[0]?.leaving).toBe(true)
  })

  it('removes a toast after its exit animation', () => {
    const state = run([add('a'), { type: 'dismiss', id: 'a' }, { type: 'remove', id: 'a' }])
    expect(state.items).toEqual([])
  })

  it('drops a queued toast at once, because it was never shown', () => {
    const start = run([add('a'), add('b'), add('c'), add('d')])
    expect(partitionToasts(start).queued.map((t) => t.id)).toEqual(['d'])
    const state = toastReducer(start, { type: 'dismiss', id: 'd' })
    expect(ids(state)).toEqual(['a', 'b', 'c'])
  })

  it('ignores unknown ids and repeated dismissals (same state reference)', () => {
    const start = run([add('a'), { type: 'dismiss', id: 'a' }])
    expect(toastReducer(start, { type: 'dismiss', id: 'a' })).toBe(start)
    expect(toastReducer(start, { type: 'remove', id: 'nope' })).toBe(start)
  })

  it('dismissAll animates the visible toasts out and drops the queued ones', () => {
    const state = run([add('a'), add('b'), add('c'), add('d'), { type: 'dismissAll' }])
    expect(ids(state)).toEqual(['a', 'b', 'c'])
    expect(state.items.every((item) => item.leaving)).toBe(true)
  })
})

describe('partitionToasts', () => {
  it('shows at most `max` and queues the rest in order', () => {
    const state = run([add('a'), add('b'), add('c'), add('d'), add('e')])
    const { visible, queued } = partitionToasts(state)
    expect(visible.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(queued.map((t) => t.id)).toEqual(['d', 'e'])
  })

  it('promotes the next queued toast as soon as a visible one starts leaving', () => {
    const state = run([add('a'), add('b'), add('c'), add('d'), { type: 'dismiss', id: 'a' }])
    const { visible, queued } = partitionToasts(state)
    expect(visible.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(queued).toEqual([])
  })

  it('promotes again once the leaving toast is removed', () => {
    const state = run([
      add('a'),
      add('b'),
      add('c'),
      add('d'),
      { type: 'dismiss', id: 'a' },
      { type: 'remove', id: 'a' },
    ])
    expect(partitionToasts(state).visible.map((t) => t.id)).toEqual(['b', 'c', 'd'])
  })

  it('respects a custom cap', () => {
    const state = run([add('a'), add('b'), add('c')], createToastState(1))
    expect(partitionToasts(state).visible.map((t) => t.id)).toEqual(['a'])
    expect(partitionToasts(state).queued.map((t) => t.id)).toEqual(['b', 'c'])
  })

  it('handles an empty state', () => {
    expect(partitionToasts(createToastState(3))).toEqual({ visible: [], queued: [] })
  })
})

describe('toastReducer: undo lifecycle', () => {
  const undo = vi.fn()
  const withUndo = (): ToastState => run([add('a', { undo, duration: TOAST_DURATION.undo })])

  it('moves idle → undoing → undone and shortens the timer', () => {
    const state = run(
      [
        { type: 'undoStart', id: 'a' },
        { type: 'undoDone', id: 'a' },
      ],
      withUndo(),
    )
    expect(state.items[0]).toMatchObject({
      phase: 'undone',
      duration: TOAST_DURATION.undone,
      revision: 1,
    })
  })

  it('records a failed undo', () => {
    const state = run(
      [
        { type: 'undoStart', id: 'a' },
        { type: 'undoFailed', id: 'a' },
      ],
      withUndo(),
    )
    expect(state.items[0]).toMatchObject({
      phase: 'undoFailed',
      duration: TOAST_DURATION.undoFailed,
    })
  })

  it('lets a failed undo be retried', () => {
    const failed = run(
      [
        { type: 'undoStart', id: 'a' },
        { type: 'undoFailed', id: 'a' },
        { type: 'undoStart', id: 'a' },
        { type: 'undoDone', id: 'a' },
      ],
      withUndo(),
    )
    expect(failed.items[0]?.phase).toBe('undone')
  })

  it('keeps the reason for a refused undo and does not retry it', () => {
    const refused = run(
      [
        { type: 'undoStart', id: 'a' },
        { type: 'undoFailed', id: 'a', refusal: 'The task changed since, so it was kept' },
      ],
      withUndo(),
    )
    expect(refused.items[0]).toMatchObject({
      phase: 'undoFailed',
      undoRefusal: 'The task changed since, so it was kept',
    })
    expect(toastReducer(refused, { type: 'undoStart', id: 'a' })).toBe(refused)
  })

  it('ignores a second undo while one is running', () => {
    const running = run([{ type: 'undoStart', id: 'a' }], withUndo())
    expect(toastReducer(running, { type: 'undoStart', id: 'a' })).toBe(running)
  })

  it('ignores undo on a toast without an undo function', () => {
    const plain = run([add('p')])
    expect(toastReducer(plain, { type: 'undoStart', id: 'p' })).toBe(plain)
  })

  it('ignores undoDone / undoFailed when no undo is running', () => {
    const idle = withUndo()
    expect(toastReducer(idle, { type: 'undoDone', id: 'a' })).toBe(idle)
    expect(toastReducer(idle, { type: 'undoFailed', id: 'a' })).toBe(idle)
  })

  it('does not start an undo on a toast that is already leaving', () => {
    const leaving = run([{ type: 'dismiss', id: 'a' }], withUndo())
    expect(toastReducer(leaving, { type: 'undoStart', id: 'a' })).toBe(leaving)
  })
})

describe('resolveDuration', () => {
  it('uses the variant default', () => {
    expect(resolveDuration('default', false)).toBe(TOAST_DURATION.default)
    expect(resolveDuration('error', false)).toBe(TOAST_DURATION.error)
  })

  it('keeps undoable toasts around at least as long as the undo window', () => {
    expect(resolveDuration('success', true)).toBe(TOAST_DURATION.undo)
    expect(resolveDuration('error', true)).toBe(TOAST_DURATION.error)
  })

  it('lets an explicit duration win, including 0 for sticky', () => {
    expect(resolveDuration('default', true, 1500)).toBe(1500)
    expect(resolveDuration('default', false, 0)).toBe(0)
    expect(resolveDuration('default', false, -5)).toBe(0)
  })
})
