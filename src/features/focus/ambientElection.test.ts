import { describe, expect, it } from 'vitest'
import {
  AMBIENT_LOCK,
  electAmbientOwner,
  type ElectionDeps,
  type LockManagerLike,
} from './ambientElection'

/** A page-wide lock manager shared by every "tab" in a test: `ifAvailable` locks are exclusive. */
function fakeLocks(): LockManagerLike & { held: Set<string> } {
  const held = new Set<string>()
  return {
    held,
    async request(name, _options, callback) {
      // Like the real API, the request is granted a moment later, never inside the call.
      await Promise.resolve()
      if (held.has(name)) return callback(null)
      held.add(name)
      try {
        return await callback({})
      } finally {
        held.delete(name)
      }
    },
  }
}

/** One tab: its visibility, and a way to bring it to the front. */
function tab(locks: LockManagerLike | undefined, visible: boolean) {
  const listeners = new Set<() => void>()
  const state = { visible }
  const deps: ElectionDeps = {
    locks,
    isVisible: () => state.visible,
    onVisible: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
  return {
    deps,
    show() {
      state.visible = true
      for (const l of [...listeners]) l()
    },
    hide() {
      state.visible = false
    },
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('electAmbientOwner', () => {
  it('elects one tab: the second tab that wants the bed stays quiet', async () => {
    const locks = fakeLocks()
    const a = tab(locks, true)
    const b = tab(locks, true)
    const owners: Record<string, boolean[]> = { a: [], b: [] }
    electAmbientOwner(a.deps, (o) => owners.a?.push(o))
    await flush()
    electAmbientOwner(b.deps, (o) => owners.b?.push(o))
    await flush()
    expect(owners.a).toEqual([true])
    expect(owners.b).toEqual([])
    expect(locks.held.has(AMBIENT_LOCK)).toBe(true)
  })

  it('a tab in the background does not take the bed, and takes it when it comes to the front', async () => {
    const locks = fakeLocks()
    const back = tab(locks, false)
    const owners: boolean[] = []
    electAmbientOwner(back.deps, (o) => owners.push(o))
    await flush()
    expect(owners).toEqual([])
    expect(locks.held.size).toBe(0)

    back.show()
    await flush()
    expect(owners).toEqual([true])
  })

  it('the playing tab keeps the bed while it is in the background', async () => {
    const locks = fakeLocks()
    const a = tab(locks, true)
    const owners: boolean[] = []
    electAmbientOwner(a.deps, (o) => owners.push(o))
    await flush()
    a.hide()
    a.show()
    a.hide()
    await flush()
    expect(owners).toEqual([true])
    expect(locks.held.has(AMBIENT_LOCK)).toBe(true)
  })

  it('stopping releases the lock, so another tab can take over when it next comes to the front', async () => {
    const locks = fakeLocks()
    const a = tab(locks, true)
    const b = tab(locks, false)
    const ownersA: boolean[] = []
    const ownersB: boolean[] = []
    const stopA = electAmbientOwner(a.deps, (o) => ownersA.push(o))
    await flush()
    electAmbientOwner(b.deps, (o) => ownersB.push(o))
    b.show()
    await flush()
    expect(ownersB).toEqual([])

    stopA()
    await flush()
    expect(ownersA).toEqual([true, false])
    expect(locks.held.size).toBe(0)

    b.hide()
    b.show()
    await flush()
    expect(ownersB).toEqual([true])
  })

  it('stopping before the lock is granted takes nothing', async () => {
    const locks = fakeLocks()
    const a = tab(locks, true)
    const owners: boolean[] = []
    const stop = electAmbientOwner(a.deps, (o) => owners.push(o))
    stop()
    await flush()
    expect(owners).toEqual([])
    expect(locks.held.size).toBe(0)
  })

  it('without Web Locks every tab plays, as it did before there was an election', () => {
    const owners: boolean[] = []
    const stop = electAmbientOwner(tab(undefined, false).deps, (o) => owners.push(o))
    expect(owners).toEqual([true])
    stop()
    expect(owners).toEqual([true, false])
  })

  it('a lock manager that refuses lets the tab play rather than nobody', async () => {
    const refusing: LockManagerLike = { request: () => Promise.reject(new Error('SecurityError')) }
    const owners: boolean[] = []
    electAmbientOwner(tab(refusing, true).deps, (o) => owners.push(o))
    await flush()
    expect(owners).toEqual([true])
  })
})
