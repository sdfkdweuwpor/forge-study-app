import { describe, expect, it, vi } from 'vitest'
import { APPLY_FALLBACK_MS, createUpdateStore } from './updateStore'

function setup() {
  const reload = vi.fn()
  const timers: { fn: () => void; ms: number }[] = []
  const store = createUpdateStore({ reload, setTimer: (fn, ms) => void timers.push({ fn, ms }) })
  return { store, reload, timers }
}

describe('updateStore', () => {
  it('starts idle and moves to waiting once, notifying subscribers', () => {
    const { store } = setup()
    const seen = vi.fn()
    store.subscribe(seen)
    expect(store.getPhase()).toBe('idle')
    store.markWaiting()
    store.markWaiting()
    expect(store.getPhase()).toBe('waiting')
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('stops notifying after unsubscribe', () => {
    const { store } = setup()
    const seen = vi.fn()
    store.subscribe(seen)()
    store.markWaiting()
    expect(seen).not.toHaveBeenCalled()
  })

  it('swaps the worker in and reloads when it takes control after "Reload"', async () => {
    const { store, reload } = setup()
    const swapIn = vi.fn().mockResolvedValue(undefined)
    store.attach(swapIn)
    store.markWaiting()
    await store.apply()
    expect(swapIn).toHaveBeenCalledOnce()
    expect(reload).not.toHaveBeenCalled()
    store.markControlling()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('never reloads a tab that did not ask: it only notes that the new version is active', () => {
    const { store, reload } = setup()
    store.attach(() => Promise.resolve())
    store.markWaiting()
    store.markControlling()
    expect(reload).not.toHaveBeenCalled()
    expect(store.getPhase()).toBe('activated')
    // A late `waiting` cannot move it back.
    store.markWaiting()
    expect(store.getPhase()).toBe('activated')
  })

  it('reloads at once when the new version is already active', async () => {
    const { store, reload } = setup()
    const swapIn = vi.fn().mockResolvedValue(undefined)
    store.attach(swapIn)
    store.markControlling()
    await store.apply()
    expect(swapIn).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads after a fallback delay when the swap never reports back', async () => {
    const { store, reload, timers } = setup()
    store.attach(() => Promise.reject(new Error('gone')))
    store.markWaiting()
    await store.apply()
    expect(timers).toHaveLength(1)
    expect(timers[0]?.ms).toBe(APPLY_FALLBACK_MS)
    timers[0]?.fn()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('ignores a second "Reload" while one is under way', async () => {
    const { store, timers } = setup()
    const swapIn = vi.fn().mockResolvedValue(undefined)
    store.attach(swapIn)
    store.markWaiting()
    await store.apply()
    await store.apply()
    expect(swapIn).toHaveBeenCalledOnce()
    expect(timers).toHaveLength(1)
  })
})
