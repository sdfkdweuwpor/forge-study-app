import { describe, expect, it, vi } from 'vitest'
import { UndoRefusedError } from '@/logic/undo'
import { runUndo } from './runUndo'
import type { ToastAction } from './toastReducer'

function record(): { actions: ToastAction[]; dispatch: (action: ToastAction) => void } {
  const actions: ToastAction[] = []
  return { actions, dispatch: (action) => void actions.push(action) }
}

describe('runUndo (the one path behind the Undo button and mod+z)', () => {
  it('starts, runs the undo, then reports it done', async () => {
    const { actions, dispatch } = record()
    const undo = vi.fn()
    await runUndo({ id: 'a', undo }, dispatch)
    expect(undo).toHaveBeenCalledTimes(1)
    expect(actions).toEqual([
      { type: 'undoStart', id: 'a' },
      { type: 'undoDone', id: 'a' },
    ])
  })

  it('waits for an async undo before it says it is done', async () => {
    const { actions, dispatch } = record()
    let finish: () => void = () => undefined
    const pending = runUndo(
      { id: 'a', undo: () => new Promise<void>((resolve) => (finish = resolve)) },
      dispatch,
    )
    expect(actions).toEqual([{ type: 'undoStart', id: 'a' }])
    finish()
    await pending
    expect(actions.at(-1)).toEqual({ type: 'undoDone', id: 'a' })
  })

  it('reports an undo that rejects as failed, with no refusal (Retry is offered)', async () => {
    const { actions, dispatch } = record()
    await runUndo({ id: 'a', undo: () => Promise.reject(new Error('disk full')) }, dispatch)
    expect(actions).toEqual([
      { type: 'undoStart', id: 'a' },
      { type: 'undoFailed', id: 'a' },
    ])
  })

  it('reports an undo that throws at once the same way', async () => {
    const { actions, dispatch } = record()
    await runUndo(
      {
        id: 'a',
        undo: () => {
          throw new Error('nope')
        },
      },
      dispatch,
    )
    expect(actions.at(-1)).toEqual({ type: 'undoFailed', id: 'a' })
  })

  it('carries the message of an UndoRefusedError, so the toast shows it and offers no Retry', async () => {
    const { actions, dispatch } = record()
    const message = 'You edited this task since, so it was left as it is.'
    await runUndo({ id: 'a', undo: () => Promise.reject(new UndoRefusedError(message)) }, dispatch)
    expect(actions.at(-1)).toEqual({ type: 'undoFailed', id: 'a', refusal: message })
  })

  it('does nothing for a toast without an undo', async () => {
    const { actions, dispatch } = record()
    await runUndo({ id: 'a' }, dispatch)
    expect(actions).toEqual([])
  })
})
