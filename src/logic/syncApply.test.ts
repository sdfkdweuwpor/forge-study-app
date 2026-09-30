import { describe, expect, it } from 'vitest'
import type { Task } from '@/db/types'
import {
  accountWinsOverSeed,
  clockCheckDue,
  clockSkew,
  duplicatePlanKeys,
  isBlobMarker,
  isRowRejection,
  keepLocalTrashBlobs,
  levelToAbsorb,
  planTaskGoalId,
  recordLabel,
  SYNC_TEXT,
  trashFilesToRescue,
} from './syncApply'

const pdf = () => new Blob(['%PDF-1.7 C182 study guide'], { type: 'application/pdf' })
const marker = { __blob: true, type: 'application/pdf', size: 25 }

const trashRow = (files: unknown[]) => ({
  id: 'trash-1',
  entityTable: 'resources',
  entityId: 'r1',
  title: 'C182 study guide',
  payload: { resources: [{ id: 'r1', fileId: 'f1' }], files },
})

describe('keepLocalTrashBlobs', () => {
  it('keeps the bytes this device holds when the pulled row only has the marker', () => {
    const blob = pdf()
    const local = trashRow([{ id: 'f1', name: 'C182 study guide.pdf', blob }])
    const remote = trashRow([{ id: 'f1', name: 'C182 study guide.pdf', blob: marker }])
    const merged = keepLocalTrashBlobs(local, remote) as typeof remote
    expect((merged.payload.files[0] as { blob: Blob }).blob).toBe(blob)
    // The pulled row itself is not changed.
    expect((remote.payload.files[0] as { blob: unknown }).blob).toBe(marker)
  })

  it('returns the pulled row itself when there is nothing to keep', () => {
    const remote = trashRow([{ id: 'f1', blob: marker }])
    expect(keepLocalTrashBlobs(undefined, remote)).toBe(remote)
    expect(keepLocalTrashBlobs(trashRow([{ id: 'f2', blob: pdf() }]), remote)).toBe(remote)
    expect(keepLocalTrashBlobs(trashRow([{ id: 'f1', blob: marker }]), remote)).toBe(remote)
    const plain = { id: 't', payload: {} }
    expect(keepLocalTrashBlobs(plain, plain)).toBe(plain)
  })

  it('leaves a file the remote row carries with real bytes alone', () => {
    const remote = trashRow([{ id: 'f1', blob: pdf() }])
    expect(keepLocalTrashBlobs(trashRow([{ id: 'f1', blob: pdf() }]), remote)).toBe(remote)
  })
})

describe('trashFilesToRescue', () => {
  it('returns the files with real bytes that a resource still points at', () => {
    const keep = { id: 'f1', blob: pdf() }
    const row = trashRow([keep, { id: 'f2', blob: pdf() }, { id: 'f3', blob: marker }])
    expect(trashFilesToRescue(row, new Set(['f1', 'f3']))).toEqual([keep])
  })

  it('returns nothing when no resource points at the files, or the row has no files', () => {
    expect(trashFilesToRescue(trashRow([{ id: 'f1', blob: pdf() }]), new Set())).toEqual([])
    expect(trashFilesToRescue({ id: 't' }, new Set(['f1']))).toEqual([])
    expect(trashFilesToRescue(undefined, new Set(['f1']))).toEqual([])
  })

  it('knows a marker when it sees one', () => {
    expect(isBlobMarker(marker)).toBe(true)
    expect(isBlobMarker(pdf())).toBe(false)
    expect(isBlobMarker(null)).toBe(false)
  })
})

describe('duplicatePlanKeys', () => {
  const task = (over: Partial<Task>): Pick<Task, 'source' | 'scheduleKey' | 'kind' | 'status'> => ({
    source: 'schedule',
    scheduleKey: 'unit-c182-4:1',
    kind: 'study',
    status: 'todo',
    ...over,
  })

  it('lists a key two open plan tasks share, sorted', () => {
    expect(
      duplicatePlanKeys([
        task({ scheduleKey: 'unit-d278-2:1' }),
        task({ scheduleKey: 'unit-d278-2:1' }),
        task({ scheduleKey: 'unit-c182-4:1' }),
        task({ scheduleKey: 'unit-c182-4:1', status: 'doing' }),
        task({ scheduleKey: 'unit-c779-1:1' }),
      ]),
    ).toEqual(['unit-c182-4:1', 'unit-d278-2:1'])
  })

  it('does not count finished tasks: the same chunk finished on two devices is two real sessions', () => {
    expect(duplicatePlanKeys([task({ status: 'done' }), task({ status: 'done' })])).toEqual([])
    expect(duplicatePlanKeys([task({ status: 'done' }), task({})])).toEqual([])
  })

  it('does not count tasks that are not plan items', () => {
    expect(
      duplicatePlanKeys([
        task({ source: 'user' }),
        task({ source: 'user' }),
        task({ scheduleKey: null }),
        task({ scheduleKey: null }),
        task({ kind: 'task' }),
        task({ kind: 'task' }),
      ]),
    ).toEqual([])
  })
})

describe('planTaskGoalId', () => {
  it('names the goal of a plan task and nothing else', () => {
    expect(planTaskGoalId({ source: 'schedule', goalId: 'goal-wgu-bscs' })).toBe('goal-wgu-bscs')
    expect(planTaskGoalId({ source: 'user', goalId: 'goal-wgu-bscs' })).toBeNull()
    expect(planTaskGoalId({ source: 'schedule', goalId: null })).toBeNull()
    expect(planTaskGoalId('nope')).toBeNull()
  })
})

describe('levelToAbsorb', () => {
  it('records the level XP from another device reached, never lowers it', () => {
    expect(levelToAbsorb(2, 5)).toBe(5)
    expect(levelToAbsorb(5, 5)).toBeNull()
    expect(levelToAbsorb(6, 5)).toBeNull()
  })
  it('records the level at once when nothing was recorded yet', () => {
    expect(levelToAbsorb(0, 4)).toBe(4)
  })
  it('does nothing for a level that cannot be', () => {
    expect(levelToAbsorb(3, 0)).toBeNull()
    expect(levelToAbsorb(3, Number.NaN)).toBeNull()
  })
})

describe('accountWinsOverSeed', () => {
  const reward = (over: Record<string, unknown> = {}) => ({
    id: 'starter-reward:0',
    createdAt: 1_000,
    updatedAt: 1_000,
    title: '30 min gaming',
    price: 300,
    ...over,
  })
  const site = (over: Record<string, unknown> = {}) => ({
    id: 'default:reddit.com',
    createdAt: 5_005,
    updatedAt: 5_000,
    kind: 'block',
    domain: 'reddit.com',
    pattern: null,
    enabled: true,
    isDefault: true,
    note: null,
    ...over,
  })

  it('is true for an untouched starter reward and an untouched default site', () => {
    expect(accountWinsOverSeed('rewards', reward(), 11)).toBe(true)
    expect(accountWinsOverSeed('blocklist', site(), 11)).toBe(true)
    // The seed spreads createdAt by 1 ms per site, the last of 11 by 10.
    expect(accountWinsOverSeed('blocklist', site({ createdAt: 5_010 }), 11)).toBe(true)
  })

  it('is false once the person changed the row', () => {
    expect(accountWinsOverSeed('rewards', reward({ updatedAt: 9_000 }), 11)).toBe(false)
    expect(accountWinsOverSeed('blocklist', site({ enabled: false }), 11)).toBe(false)
    expect(accountWinsOverSeed('blocklist', site({ updatedAt: 60_000 }), 11)).toBe(false)
    expect(accountWinsOverSeed('blocklist', site({ note: 'Distracting' }), 11)).toBe(false)
    expect(accountWinsOverSeed('blocklist', site({ kind: 'allow', pattern: 'x/y' }), 11)).toBe(
      false,
    )
  })

  it('is false for rows with another id or from another table, and for rows that are not rows', () => {
    expect(accountWinsOverSeed('rewards', reward({ id: 'reward-7f3a' }), 11)).toBe(false)
    expect(accountWinsOverSeed('blocklist', site({ id: 'block-a' }), 11)).toBe(false)
    expect(accountWinsOverSeed('blocklist', site({ id: 'default:tiktok.com' }), 11)).toBe(false)
    expect(accountWinsOverSeed('tasks', reward({ id: 'starter-reward:0' }), 11)).toBe(false)
    expect(accountWinsOverSeed('rewards', undefined, 11)).toBe(false)
    expect(accountWinsOverSeed('rewards', reward({ updatedAt: 'now' }), 11)).toBe(false)
  })
})

describe('isRowRejection', () => {
  it('is a refusal of content for a 4xx that is not sign-in, access, timeout, size or rate', () => {
    expect(isRowRejection('server', 400)).toBe(true)
    expect(isRowRejection('server', 409)).toBe(true)
    expect(isRowRejection('server', 422)).toBe(true)
  })
  it('is not for the ones the engine handles another way', () => {
    for (const status of [401, 403, 408, 413, 429])
      expect(isRowRejection('server', status)).toBe(false)
    expect(isRowRejection('server', 503)).toBe(false)
    expect(isRowRejection('server', null)).toBe(false)
    expect(isRowRejection('forbidden', 400)).toBe(false)
    expect(isRowRejection('tooLarge', 400)).toBe(false)
  })
})

describe('words', () => {
  it('names a record by its title, shortened, or by its kind', () => {
    expect(recordLabel('tasks', { title: 'C779 · Unit 2: CSS layout (45 min)' })).toBe(
      '“C779 · Unit 2: CSS layout (45 min)”',
    )
    expect(recordLabel('resources', { title: '  Study   guide  ' })).toBe('“Study guide”')
    expect(recordLabel('tasks', { title: 'x'.repeat(100) })).toBe(`“${'x'.repeat(59)}…”`)
    expect(recordLabel('goals', { id: 'g1' })).toBe('a goal')
    expect(recordLabel('units', { id: 'u1' })).toBe('a unit')
    expect(recordLabel('checkIns', null)).toBe('a check-in')
    expect(recordLabel('xpEvents', undefined)).toBe('an item')
  })

  it('writes calm sentences that name the record and never blame', () => {
    expect(SYNC_TEXT.tooLarge('“Notes”')).toBe(
      '“Notes” is too large to sync, so it stays on this device. Everything else synced.',
    )
    expect(SYNC_TEXT.refused('“Notes”')).toContain('stays on this device')
    for (const text of [SYNC_TEXT.updateNeeded, SYNC_TEXT.snapshot, SYNC_TEXT.signedOut]) {
      expect(text).not.toMatch(/!|error|failed|wrong/i)
    }
  })
})

describe('the clock', () => {
  it('measures again when never measured, after an hour, or when the clock went back', () => {
    expect(clockCheckDue(null, 1000)).toBe(true)
    expect(clockCheckDue(1000, 1000 + 59 * 60_000)).toBe(false)
    expect(clockCheckDue(1000, 1000 + 60 * 60_000)).toBe(true)
    expect(clockCheckDue(1_000_000, 500_000)).toBe(true)
  })

  it('takes the midpoint of the call as the moment the server answered', () => {
    expect(clockSkew(10_000, 1_000, 3_000)).toBe(8_000)
    expect(clockSkew(1_000, 1_000, 1_001)).toBe(0)
    expect(clockSkew(-59_000, 1_000, 1_001)).toBe(-60_001 + 1)
  })
})
