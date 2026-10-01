/**
 * Domain event bus (PLAN §1.2). Repos `emit()` inside their transaction; handlers run only after
 * the outermost transaction commits, and never if it aborts. Outside a transaction, events are
 * dispatched on the next microtask. Handlers must be idempotent; errors are caught and reported,
 * never thrown back into the writer.
 */
import Dexie, { type Transaction } from 'dexie'
import type { ID, ISODate, Millis, SettingsData, TableName, XpSource } from './types'

export type SettingsSection = keyof SettingsData

export type DomainEvent =
  | { type: 'task.created'; taskId: ID }
  | { type: 'task.changed'; taskId: ID }
  | { type: 'task.completed'; taskId: ID; day: ISODate; at: Millis }
  /** `day` = the day it had been completed on. */
  | { type: 'task.uncompleted'; taskId: ID; day: ISODate }
  | { type: 'task.deleted'; taskId: ID }
  | { type: 'session.started'; sessionId: ID }
  | { type: 'session.ended'; sessionId: ID; day: ISODate; counted: boolean }
  | { type: 'milestone.completed'; milestoneId: ID; goalId: ID }
  | { type: 'milestone.uncompleted'; milestoneId: ID; goalId: ID }
  | { type: 'goal.changed'; goalId: ID }
  | { type: 'xp.changed'; day: ISODate; source: XpSource; amount: number }
  | { type: 'redemption.changed'; redemptionId: ID }
  | { type: 'day.started'; day: ISODate }
  | { type: 'settings.changed'; sections: SettingsSection[] }
  /**
   * Cloud sync applied rows from the server (PLAN §4.7.5): raised once per sync cycle that changed
   * anything, never per row. Remote work raises none of the per-action events above (their handlers pay XP
   * and show toasts for things done on this device), so this is how derived data catches up: handlers
   * rebuild caches, reconcile badges and heal plan tasks, quietly. `tables` are the tables that changed;
   * `goalIds` the goals whose plan tasks arrived.
   */
  | { type: 'sync.applied'; tables: TableName[]; goalIds: ID[] }

export type DomainEventType = DomainEvent['type']
export type DomainEventOf<T extends DomainEventType> = Extract<DomainEvent, { type: T }>

export interface DomainHandlerFor<T extends DomainEventType> {
  /** Unique, e.g. `'progress.streakDay'`. Used in error reports. */
  id: string
  event: T
  handle(event: DomainEventOf<T>): void | Promise<void>
}
/** Any handler; the form feature manifests list in `domainHandlers`. */
export type DomainHandler = { [K in DomainEventType]: DomainHandlerFor<K> }[DomainEventType]

/** Identity helper that infers the event type: `defineHandler({ id, event: 'task.completed', handle(e) {…} })`. */
export function defineHandler<T extends DomainEventType>(
  h: DomainHandlerFor<T>,
): DomainHandlerFor<T> {
  return h
}

export type DomainErrorReporter = (
  error: unknown,
  info: { handlerId: string; event: DomainEvent },
) => void

type AnyHandler = {
  id: string
  event: DomainEventType
  handle(event: DomainEvent): void | Promise<void>
}

const handlers = new Set<AnyHandler>()
const pending = new Set<Promise<unknown>>()
const txQueues = new WeakMap<Transaction, DomainEvent[]>()
let reportError: DomainErrorReporter = () => {}

function track(p: Promise<unknown>): void {
  pending.add(p)
  void p.finally(() => pending.delete(p))
}

function dispatch(event: DomainEvent): void {
  for (const h of handlers) {
    if (h.event !== event.type) continue
    // Run outside any Dexie transaction zone so handlers can open their own transactions.
    const run = Promise.resolve().then(() => Dexie.ignoreTransaction(() => h.handle(event)))
    track(
      run.then(
        () => undefined,
        (error: unknown) => {
          try {
            reportError(error, { handlerId: h.id, event })
          } catch {
            // A broken reporter must not break the bus.
          }
        },
      ),
    )
  }
}

function currentRootTransaction(): Transaction | null {
  let tx = (Dexie.currentTransaction as Transaction | null | undefined) ?? null
  while (tx?.parent) tx = tx.parent
  return tx
}

/** Queue `event` until the current transaction commits (dropped on abort), or dispatch soon if none. */
export function emit(event: DomainEvent): void {
  const tx = currentRootTransaction()
  if (!tx) {
    dispatch(event)
    return
  }
  let queue = txQueues.get(tx)
  if (!queue) {
    const q: DomainEvent[] = []
    txQueues.set(tx, q)
    queue = q
    track(
      new Promise<void>((resolve) => {
        tx.on('complete', () => {
          for (const e of q) dispatch(e)
          resolve()
        })
        tx.on('abort', () => resolve())
        tx.on('error', () => resolve())
      }),
    )
  }
  queue.push(event)
}

/** Register a handler; returns an unsubscribe function. */
export function subscribe(handler: DomainHandler): () => void {
  const h = handler as AnyHandler
  handlers.add(h)
  return () => {
    handlers.delete(h)
  }
}

/** Register many handlers (e.g. from the feature registry); returns one unsubscribe function. */
export function subscribeAll(list: readonly DomainHandler[]): () => void {
  const offs = list.map(subscribe)
  return () => offs.forEach((off) => off())
}

/** Convenience listener, mostly for tests and non-feature code. */
export function onDomainEvent<T extends DomainEventType>(
  event: T,
  fn: (e: DomainEventOf<T>) => void | Promise<void>,
): () => void {
  return subscribe({ id: `listener:${event}`, event, handle: fn } as DomainHandler)
}

/** Where handler errors go (the app shell wires this to its error reporting). */
export function setDomainErrorReporter(reporter: DomainErrorReporter): void {
  reportError = reporter
}

/** Resolves once every queued transaction has settled and every running handler has finished. */
export async function settleDomainEvents(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending])
}

/** Test helper: drop all handlers and restore the silent reporter. */
export function resetDomainEvents(): void {
  handlers.clear()
  reportError = () => {}
}
