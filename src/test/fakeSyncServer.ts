/**
 * A fake Supabase for the repo engine's tests (PLAN §4.7.8): the real `SyncServer` interface over
 * `SyncServerModel` (the `forge_rows` table and its trigger, rule for rule), plus switches for what goes
 * wrong: offline, failing the next N calls, a lost answer after the server committed, a 413 over a size,
 * a row the server refuses, a row from a newer Forge, a sign-in failure. Test-only.
 *
 * The server's clock advances at least 1 ms per call (the real `now()` of two calls never repeats, and
 * the stamp clamp and the skew measurement depend on it), and can run ahead of or behind the test's
 * clock with `clockOffsetMs`. Several accounts share one model (`forAccount`), and any number of devices
 * talk to the same server object: the model is the cloud, and this is one person's connection to it.
 */
import type { Millis } from '@/db/types'
import {
  SyncTransportError,
  type PushRow,
  type ServerRow,
  type SyncServer,
} from '@/logic/sync'
import { SyncServerModel } from '@/logic/syncServerModel'

export type FakeOp = 'push' | 'pull' | 'serverTime'

export interface FakeCall {
  op: FakeOp
  /** Rows in a push, or returned by a pull. */
  rows: number
  /** The cursor a pull asked for. */
  afterSeq?: number
}

export interface FakeServerOptions {
  /** The account's id (`auth.uid()`). Default: a fixed test id. */
  userId?: string | null
  /** Share one cloud between servers (another account, another connection). */
  model?: SyncServerModel
  /** The base clock in ms (default `Date.now`). */
  clock?: () => Millis
}

export const offlineError = (): SyncTransportError =>
  new SyncTransportError('offline', "Can't reach Supabase. Check your internet connection.", {
    status: null,
  })

export const serverError = (status = 503): SyncTransportError =>
  new SyncTransportError('server', "Supabase isn't answering right now.", { status })

export const signedOutError = (): SyncTransportError =>
  new SyncTransportError('signedOut', 'Your sign-in has expired.', { status: 401 })

export const TEST_USER_ID = '8b1f2b7e-3d0a-4f55-9a52-6f6f4c1a0a01'

export class FakeSyncServer implements SyncServer {
  readonly model: SyncServerModel
  userId: string | null
  /** Added to the base clock: a server whose clock is ahead (+) or behind (−) the test's. */
  clockOffsetMs = 0
  /** Every call fails with an offline error while true. */
  offline = false
  /** Every call fails with a sign-in failure (401) while true. */
  signedOut = false
  /** A push whose body is larger than this many bytes is answered with 413 and stores nothing. */
  maxPushBytes: number | null = null
  /** A push holding a row this matches is answered with 400 and stores nothing. */
  refuseRow: ((row: PushRow) => boolean) | null = null
  /** Runs after a push was stored and before it answers (an edit made while the request is out). */
  afterPushStored: ((rows: readonly PushRow[]) => void | Promise<void>) | null = null
  /** Runs on every pull before it answers (a crash in the middle of a pull, a write during one). */
  beforePullAnswer: ((afterSeq: number) => void | Promise<void>) | null = null
  readonly calls: FakeCall[] = []

  private readonly base: () => Millis
  private last = 0
  private failures: { op: FakeOp | 'any'; left: number; error: SyncTransportError }[] = []
  private lostAnswers = 0

  constructor(options: FakeServerOptions = {}) {
    this.model = options.model ?? new SyncServerModel()
    this.userId = options.userId === undefined ? TEST_USER_ID : options.userId
    this.base = options.clock ?? Date.now
  }

  /** Another account on the same cloud. */
  forAccount(userId: string | null): FakeSyncServer {
    return new FakeSyncServer({ userId, model: this.model, clock: this.base })
  }

  /** The server's time for the next call: never the same or earlier than the last one. */
  now(): Millis {
    this.last = Math.max(this.base() + this.clockOffsetMs, this.last + 1)
    return this.last
  }

  /** Fails the next `count` calls (of one kind, or any) with `error`. */
  failNext(count: number, error: SyncTransportError = serverError(), op: FakeOp | 'any' = 'any'): void {
    this.failures.push({ op, left: count, error })
  }

  /** The next `count` pushes are stored, then answered with an offline error: the answer was lost. */
  loseAnswerNext(count = 1): void {
    this.lostAnswers += count
  }

  /** Forgets every switch (not the stored rows, not the call log). */
  calm(): void {
    this.offline = false
    this.signedOut = false
    this.maxPushBytes = null
    this.refuseRow = null
    this.afterPushStored = null
    this.beforePullAnswer = null
    this.failures = []
    this.lostAnswers = 0
  }

  /** The account's rows, tombstones included, as stored. */
  rows(): ServerRow[] {
    return this.model.rows(this.userId ?? '')
  }

  /** One stored row, or undefined. */
  row(tbl: string, id: string): ServerRow | undefined {
    return this.model.get(this.userId ?? '', tbl, id)
  }

  /** Writes a row as another device would, by any means: straight into the account. */
  inject(rows: readonly PushRow[]): void {
    this.model.push(this.userId, rows, this.now())
  }

  private gate(op: FakeOp): void {
    if (this.offline) throw offlineError()
    if (this.signedOut) throw signedOutError()
    const failing = this.failures.find((f) => f.left > 0 && (f.op === 'any' || f.op === op))
    if (failing) {
      failing.left -= 1
      throw failing.error
    }
  }

  async push(rows: readonly PushRow[]): Promise<void> {
    this.calls.push({ op: 'push', rows: rows.length })
    this.gate('push')
    if (this.maxPushBytes !== null && JSON.stringify(rows).length > this.maxPushBytes) {
      throw new SyncTransportError('tooLarge', 'That change was too large to send in one piece.', {
        status: 413,
      })
    }
    if (this.refuseRow && rows.some(this.refuseRow)) {
      throw new SyncTransportError('server', 'Supabase refused the request.', {
        status: 400,
        code: '22P02',
      })
    }
    this.model.push(this.userId, rows, this.now())
    await this.afterPushStored?.(rows)
    if (this.lostAnswers > 0) {
      this.lostAnswers -= 1
      throw offlineError()
    }
  }

  async pull(afterSeq: number, limit: number): Promise<ServerRow[]> {
    this.gate('pull')
    const page = this.model.pull(this.userId, afterSeq, limit)
    this.calls.push({ op: 'pull', rows: page.length, afterSeq })
    await this.beforePullAnswer?.(afterSeq)
    return page
  }

  async serverTime(): Promise<Millis> {
    this.calls.push({ op: 'serverTime', rows: 0 })
    this.gate('serverTime')
    return this.model.serverTime(this.userId, this.now())
  }

  /** How many calls of one kind were made. */
  count(op: FakeOp): number {
    return this.calls.filter((c) => c.op === op).length
  }
}
