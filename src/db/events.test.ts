import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import {
  defineHandler,
  emit,
  onDomainEvent,
  resetDomainEvents,
  setDomainErrorReporter,
  settleDomainEvents,
  subscribe,
  subscribeAll,
  type DomainEvent,
} from '@/db/events'
import type { Reward } from '@/db/types'

const reward = (id: string): Omit<Reward, 'createdAt' | 'updatedAt'> => ({
  id,
  title: `Reward ${id}`,
  icon: '🎁',
  price: 100,
  description: '',
  archived: false,
  order: 0,
})

beforeEach(async () => {
  resetDomainEvents()
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(async () => {
  await settleDomainEvents()
  resetDomainEvents()
})

describe('domain event bus', () => {
  it('delivers an event only after its transaction commits, and handlers see committed data', async () => {
    const seen: string[] = []
    const log: string[] = []
    onDomainEvent('redemption.changed', async (e) => {
      log.push('handler')
      const row = await db.rewards.get(e.redemptionId)
      seen.push(row?.title ?? 'missing')
    })

    await db.transaction('rw', db.rewards, async () => {
      await db.rewards.add(reward('a'))
      emit({ type: 'redemption.changed', redemptionId: 'a' })
      await db.rewards.get('a') // keep the transaction busy after emitting
      await Promise.resolve()
      log.push('tx-body-end')
    })
    log.push('tx-resolved')
    await settleDomainEvents()

    expect(seen).toEqual(['Reward a'])
    expect(log.indexOf('handler')).toBeGreaterThan(log.indexOf('tx-body-end'))
  })

  it('drops events from a transaction that aborts', async () => {
    const calls: DomainEvent[] = []
    onDomainEvent('task.created', (e) => {
      calls.push(e)
    })
    await expect(
      db.transaction('rw', db.rewards, async () => {
        await db.rewards.add(reward('x'))
        emit({ type: 'task.created', taskId: 'x' })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    await settleDomainEvents()
    expect(calls).toEqual([])
    expect(await db.rewards.count()).toBe(0)
  })

  it('waits for the outermost transaction when emitted from a nested one', async () => {
    const log: string[] = []
    onDomainEvent('goal.changed', () => {
      log.push('handler')
    })
    await db.transaction('rw', db.rewards, db.goals, async () => {
      await db.transaction('rw', db.rewards, async () => {
        await db.rewards.add(reward('n'))
        emit({ type: 'goal.changed', goalId: 'g' })
      })
      log.push('inner-done')
      await db.rewards.count()
      log.push('outer-body-end')
    })
    await settleDomainEvents()
    expect(log).toEqual(['inner-done', 'outer-body-end', 'handler'])
  })

  it('dispatches asynchronously when emitted outside a transaction, in emit order', async () => {
    const got: string[] = []
    onDomainEvent('day.started', (e) => {
      got.push(e.day)
    })
    emit({ type: 'day.started', day: '2026-09-29' })
    emit({ type: 'day.started', day: '2026-09-30' })
    expect(got).toEqual([])
    await settleDomainEvents()
    expect(got).toEqual(['2026-09-29', '2026-09-30'])
  })

  it('routes by event type and lets handlers open their own transactions', async () => {
    const off = subscribe(
      defineHandler({
        id: 'test.copyReward',
        event: 'task.completed',
        async handle(e) {
          await db.transaction('rw', db.rewards, async () => {
            await db.rewards.add(reward(`from-${e.taskId}`))
          })
        },
      }),
    )
    await db.transaction('rw', db.tasks, async () => {
      emit({ type: 'task.completed', taskId: 't1', day: '2026-09-29', at: 1 })
      emit({ type: 'task.uncompleted', taskId: 't1', day: '2026-09-29' })
    })
    await settleDomainEvents()
    expect(await db.rewards.get('from-t1')).toBeDefined()
    expect(await db.rewards.count()).toBe(1)

    off()
    emit({ type: 'task.completed', taskId: 't2', day: '2026-09-29', at: 2 })
    await settleDomainEvents()
    expect(await db.rewards.count()).toBe(1)
  })

  it('reports handler errors without affecting the writer or other handlers', async () => {
    const errors: string[] = []
    setDomainErrorReporter((err, info) => {
      errors.push(`${info.handlerId}:${(err as Error).message}`)
    })
    const ok: string[] = []
    const off = subscribeAll([
      defineHandler({
        id: 'bad.sync',
        event: 'session.ended',
        handle() {
          throw new Error('sync fail')
        },
      }),
      defineHandler({
        id: 'bad.async',
        event: 'session.ended',
        handle: async () => {
          await Promise.resolve()
          throw new Error('async fail')
        },
      }),
      defineHandler({
        id: 'good',
        event: 'session.ended',
        handle(e) {
          ok.push(e.sessionId)
        },
      }),
    ])
    await db.transaction('rw', db.sessions, async () => {
      emit({ type: 'session.ended', sessionId: 's1', day: '2026-09-29', counted: true })
    })
    await settleDomainEvents()
    expect(ok).toEqual(['s1'])
    expect(errors.sort()).toEqual(['bad.async:async fail', 'bad.sync:sync fail'])
    off()
  })
})
