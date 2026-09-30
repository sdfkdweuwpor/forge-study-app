/**
 * Several devices in one database, for the sync engine's tests (PLAN §4.7.8). The repos talk to the one
 * `db` singleton, so a "device" is that database's whole content, saved and loaded: every table,
 * `syncOutbox` and `syncState` included, in one transaction marked remote-apply (nothing is queued and
 * no timestamp is re-stamped). Switching devices is saving the live one and loading the other.
 *
 * What else belongs to a device is kept apart too: its stamp clock (`StampClock`, which the tracking
 * middleware reads from `db.syncTracker`), so two devices never share a hybrid clock, and its wall clock
 * (the real time plus an offset, so a device can run minutes behind or ahead; use `now()` as a cycle's
 * `now`). Test-only.
 */
import { db } from '@/db/db'
import { TABLE_NAMES } from '@/db/schema'
import { markRemoteApply } from '@/db/sync/remoteApply'
import { StampClock } from '@/db/sync/stamp'
import type { Millis, SyncOutboxEntry, SyncStateRow } from '@/db/types'

type Image = Map<string, unknown[]>

async function save(): Promise<Image> {
  const image: Image = new Map()
  await db.transaction('r', db.tables, async () => {
    for (const name of TABLE_NAMES) image.set(name, await db.table(name).toArray())
  })
  return image
}

async function load(image: Image | undefined): Promise<void> {
  await db.transaction('rw', db.tables, async (tx) => {
    markRemoteApply(tx.idbtrans)
    for (const name of TABLE_NAMES) {
      const table = db.table(name)
      await table.clear()
      const rows = image?.get(name) ?? []
      if (rows.length > 0) await table.bulkPut(rows)
    }
  })
}

export class Devices {
  private readonly images = new Map<string, Image>()
  private readonly stamps = new Map<string, StampClock>()
  private readonly offsets = new Map<string, number>()
  /** The device whose data is in the database right now. */
  current: string

  /** `first` starts as whatever the database holds now. Use `Devices.create`, which also reads its flags. */
  constructor(first = 'A') {
    this.current = first
    this.register(first)
    this.install(first)
  }

  /** The devices, with the first one as the database stands (its sync flag and stamp floor read). */
  static async create(first = 'A'): Promise<Devices> {
    const devices = new Devices(first)
    await devices.reload(first)
    return devices
  }

  private register(name: string, offsetMs = 0): void {
    if (this.stamps.has(name)) return
    this.offsets.set(name, offsetMs)
    this.stamps.set(name, new StampClock(() => this.now(name)))
  }

  /** Puts `name`'s stamp clock under the tracking middleware and follows its tracking switch. */
  private install(name: string): void {
    const clock = this.stamps.get(name)
    if (clock) Reflect.set(db.syncTracker, 'stamps', clock)
  }

  /** Adds a device (empty) whose clock runs `offsetMs` ahead (+) or behind (−) real time. */
  add(name: string, offsetMs = 0): void {
    this.register(name, offsetMs)
    if (!this.images.has(name)) this.images.set(name, new Map())
  }

  /** This device's wall clock: real time plus its offset. */
  now(name: string = this.current): Millis {
    return Date.now() + (this.offsets.get(name) ?? 0)
  }

  /** Runs a device's clock ahead or behind from now on. */
  setOffset(name: string, offsetMs: number): void {
    this.offsets.set(name, offsetMs)
  }

  /** The other device's data into the database; the current one is saved first. */
  async switchTo(name: string): Promise<void> {
    if (name === this.current) return
    this.register(name)
    this.images.set(this.current, await save())
    await load(this.images.get(name))
    this.current = name
    this.install(name)
    await this.reload(name)
  }

  /** The device's sync flag and stamp floor, as the app reads them when the database opens. */
  private async reload(name: string): Promise<void> {
    const state = (await db.syncState.get('device')) as SyncStateRow | undefined
    const newest = (await db.syncOutbox.orderBy('at').last()) as SyncOutboxEntry | undefined
    this.stamps.get(name)?.seed({ maxSeenStamp: state?.maxSeenStamp ?? 0, lastStamp: newest?.at ?? 0 })
    db.syncTracker.setEnabled(state?.enabled === true)
  }

  /** What another device holds right now (its saved copy, or the live database for the current one). */
  async rows(name: string, table: string): Promise<unknown[]> {
    if (name === this.current) return db.table(table).toArray()
    return this.images.get(name)?.get(table) ?? []
  }

  /** Forgets every device and empties the database: the next test starts clean, on device `first`. */
  async reset(first = 'A'): Promise<void> {
    this.images.clear()
    this.stamps.clear()
    this.offsets.clear()
    this.current = first
    this.register(first)
    this.install(first)
    db.syncTracker.setEnabled(false)
    await load(undefined)
  }
}
