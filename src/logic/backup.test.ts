import { describe, expect, it } from 'vitest'
import {
  BACKUP_APP,
  BACKUP_FORMAT,
  FILES_EMBED_LIMIT_BYTES,
  RESET_PHRASE,
  backupAgeLabel,
  backupFilename,
  backupReminderDue,
  base64ToBytes,
  buildBackup,
  bytesToBase64,
  countItems,
  hasUserData,
  isEncodedBlob,
  isResetPhrase,
  migrateBackup,
  migrateBackupV1toV2,
  parseBackup,
  planRestore,
  safetyCopyFilename,
  serializeBackup,
  summarizeBackup,
  validateBackup,
  type BackupContext,
  type BackupFile,
  type ReminderInput,
} from './backup'

const NOW = new Date(2026, 8, 29, 9, 30).getTime() // Tue 2026-09-29 09:30 (New York)
const DAY = 24 * 60 * 60 * 1000

const CTX: BackupContext = {
  currentVersion: 2,
  knownTables: [
    'settings',
    'tasks',
    'goals',
    'milestones',
    'files',
    'plannedAssessments',
    'snapshots',
  ],
  ignoredTables: ['snapshots'],
}

const v1Task = {
  id: 'task-1',
  title: 'Read chapter 3 of C182',
  status: 'todo',
  source: 'schedule',
  dueDate: '2026-09-30',
  dueTime: null,
  estimateMinutes: 45,
}

function backup(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    app: 'forge',
    format: 1,
    schemaVersion: 2,
    appVersion: '0.1.0',
    exportedAt: '2026-09-22T13:30:00.000Z',
    notes: [],
    tables: {
      settings: [{ id: 'app' }],
      tasks: [{ id: 't1', title: 'Email mentor' }],
      goals: [{ id: 'g1', title: 'B.S. Computer Science' }],
    },
    ...overrides,
  }
}

function errorsOf(value: unknown): string[] {
  const r = validateBackup(value, CTX)
  if (r.ok) throw new Error('expected the backup to be refused')
  return r.errors
}

describe('base64', () => {
  it('round-trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes))
  })

  it('round-trips more than one chunk, and nothing', () => {
    const big = Uint8Array.from({ length: 0x8000 * 2 + 17 }, (_, i) => (i * 31) % 256)
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big)
    expect(bytesToBase64(new Uint8Array())).toBe('')
    expect(base64ToBytes('')).toEqual(new Uint8Array())
  })

  it('matches the standard alphabet (padding included)', () => {
    expect(bytesToBase64(new TextEncoder().encode('Forge'))).toBe('Rm9yZ2U=')
    expect(new TextDecoder().decode(base64ToBytes('Rm9yZ2U='))).toBe('Forge')
  })
})

describe('buildBackup', () => {
  const pdf = (id: string, size: number) => ({
    id,
    createdAt: 1,
    updatedAt: 1,
    name: `${id}.pdf`,
    mime: 'application/pdf',
    size,
    blob: new Blob([new Uint8Array(size).fill(65)], { type: 'application/pdf' }),
  })

  it('stamps version, app version and date, and copies the rows', async () => {
    const tables = { tasks: [{ id: 't1' }], settings: [{ id: 'app' }] }
    const file = await buildBackup({ tables, schemaVersion: 2, appVersion: '0.1.0', now: NOW })
    expect(file).toMatchObject({
      app: BACKUP_APP,
      format: BACKUP_FORMAT,
      schemaVersion: 2,
      appVersion: '0.1.0',
      exportedAt: new Date(NOW).toISOString(),
      notes: [],
    })
    expect(file.tables).toEqual(tables)
    expect(file.tables.tasks).not.toBe(tables.tasks)
  })

  it('embeds attached files as base64 while they fit', async () => {
    const file = await buildBackup({
      tables: { files: [pdf('f1', 1000)] },
      schemaVersion: 2,
      appVersion: '0.1.0',
      now: NOW,
    })
    const row = file.tables.files?.[0] as { blob: unknown; name: string }
    expect(isEncodedBlob(row.blob)).toBe(true)
    expect(row.blob).toMatchObject({ __blob: true, type: 'application/pdf', size: 1000 })
    const encoded = row.blob as { base64: string }
    expect(base64ToBytes(encoded.base64)).toEqual(new Uint8Array(1000).fill(65))
    expect(file.notes).toEqual([])
    // The result is plain JSON.
    expect(JSON.parse(serializeBackup(file))).toEqual(JSON.parse(JSON.stringify(file)))
  })

  it('embeds exactly at the limit and skips everything one byte over, with a note', async () => {
    const at = await buildBackup({
      tables: { files: [pdf('f1', 60), pdf('f2', 40)] },
      schemaVersion: 2,
      appVersion: '0.1.0',
      now: NOW,
      embedLimitBytes: 100,
    })
    expect(at.notes).toEqual([])
    expect((at.tables.files as { blob: { base64?: string } }[]).every((f) => f.blob.base64)).toBe(
      true,
    )

    const over = await buildBackup({
      tables: { files: [pdf('f1', 60), pdf('f2', 41)] },
      schemaVersion: 2,
      appVersion: '0.1.0',
      now: NOW,
      embedLimitBytes: 100,
    })
    const rows = over.tables.files as { blob: { __blob: boolean; size: number; base64?: string } }[]
    expect(rows.map((f) => f.blob.base64)).toEqual([undefined, undefined])
    expect(rows.map((f) => f.blob.size)).toEqual([60, 41])
    expect(over.notes).toHaveLength(1)
    expect(over.notes[0]).toContain('2')
    expect(over.notes[0]).toContain('limit')
  })

  it('leaves the bytes out on request (snapshots)', async () => {
    const file = await buildBackup({
      tables: { files: [pdf('f1', 10)] },
      schemaVersion: 2,
      appVersion: '0.1.0',
      now: NOW,
      embedFiles: false,
    })
    expect((file.tables.files?.[0] as { blob: { base64?: string } }).blob.base64).toBeUndefined()
    expect(file.notes).toHaveLength(1)
  })

  it('has a 50 MB default limit', () => {
    expect(FILES_EMBED_LIMIT_BYTES).toBe(50 * 1024 * 1024)
  })
})

describe('file names', () => {
  it('names the export and the pre-import copy by local day', () => {
    expect(backupFilename(NOW)).toBe('forge-backup-2026-09-29.json')
    expect(safetyCopyFilename(NOW)).toBe('forge-before-import-2026-09-29.json')
  })
})

describe('parseBackup', () => {
  it('reads what serializeBackup wrote', async () => {
    const built = await buildBackup({
      tables: { settings: [{ id: 'app' }], tasks: [{ id: 't1' }, { id: 't2' }] },
      schemaVersion: 2,
      appVersion: '0.1.0',
      now: NOW,
    })
    for (const pretty of [true, false]) {
      const r = parseBackup(serializeBackup(built, pretty), CTX)
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.file).toEqual(built)
        expect(r.warnings).toEqual([])
      }
    }
  })

  it('says what is wrong with a file that is not JSON, or empty', () => {
    const notJson = parseBackup('{"app": "forge", "tables"', CTX)
    expect(notJson.ok).toBe(false)
    if (!notJson.ok) expect(notJson.errors[0]).toMatch(/readable JSON/)
    const empty = parseBackup('  ', CTX)
    if (!empty.ok) expect(empty.errors).toEqual(['That file is empty.'])
    expect(empty.ok).toBe(false)
  })

  it('refuses JSON that is not a Forge backup', () => {
    expect(errorsOf([])[0]).toMatch(/doesn’t hold a Forge backup/)
    expect(errorsOf(null)[0]).toMatch(/doesn’t hold a Forge backup/)
    expect(errorsOf('text')[0]).toMatch(/doesn’t hold a Forge backup/)
    expect(errorsOf({ tasks: [] })[0]).toMatch(/wasn’t made by Forge/)
    expect(errorsOf(backup({ app: 'notes' }))[0]).toMatch(/wasn’t made by Forge/)
  })

  it('checks the file format', () => {
    expect(errorsOf(backup({ format: 2 }))[0]).toMatch(/newer file format/)
    expect(errorsOf(backup({ format: undefined }))[0]).toMatch(/unknown file format/)
    expect(errorsOf(backup({ format: 'one' }))[0]).toMatch(/unknown file format/)
  })

  it('checks the data version: missing, malformed, or newer than this build', () => {
    for (const bad of [undefined, 'two', 0, -1, 1.5, null]) {
      expect(errorsOf(backup({ schemaVersion: bad }))[0]).toMatch(/no valid data version/)
    }
    const newer = errorsOf(backup({ schemaVersion: 3 }))[0]
    expect(newer).toMatch(/newer version of Forge/)
    expect(newer).toContain('data version 3')
    expect(newer).toContain('up to 2')
  })

  it('accepts the current and older data versions', () => {
    expect(validateBackup(backup({ schemaVersion: 2 }), CTX).ok).toBe(true)
    expect(validateBackup(backup({ schemaVersion: 1 }), CTX).ok).toBe(true)
  })

  it('needs a real export date and a table map', () => {
    expect(errorsOf(backup({ exportedAt: undefined }))[0]).toMatch(/export date/)
    expect(errorsOf(backup({ exportedAt: 'last Tuesday' }))[0]).toMatch(/export date/)
    expect(errorsOf(backup({ tables: undefined }))[0]).toMatch(/no tables/)
    expect(errorsOf(backup({ tables: [] }))[0]).toMatch(/no tables/)
  })

  it('names the table and row of a bad row, and counts the rest', () => {
    const errors = errorsOf(
      backup({
        tables: {
          tasks: [{ id: 't1' }, { title: 'no id' }, { id: '' }, 'text'],
          goals: 'nope',
        },
      }),
    )
    expect(errors).toContain('The “goals” table isn’t a list.')
    expect(errors).toContain('“tasks” row 2 has no id, and 2 more like it.')
  })

  it('caps the list of problems', () => {
    const tables = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => [n, 'nope']))
    const r = validateBackup(backup({ tables }), {
      ...CTX,
      knownTables: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toHaveLength(6)
      expect(r.errors[5]).toBe('…and 2 more problems.')
    }
  })

  it('ignores the snapshots table silently and warns about tables it does not know', () => {
    const r = validateBackup(
      backup({
        tables: {
          tasks: [{ id: 't1' }],
          snapshots: [{ id: 's1', data: '{}' }],
          telepathy: [{ id: 'x' }],
        },
      }),
      CTX,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(Object.keys(r.file.tables)).toEqual(['tasks'])
      expect(r.warnings).toHaveLength(1)
      expect(r.warnings[0]).toContain('telepathy')
    }
  })

  it('refuses a backup with nothing in it (it could only erase data)', () => {
    expect(errorsOf(backup({ tables: {} }))[0]).toMatch(/empty/)
    expect(errorsOf(backup({ tables: { settings: [{ id: 'app' }], tasks: [] } }))[0]).toMatch(
      /empty/,
    )
  })

  it('accepts the crash screen’s raw dump (no format, no app version)', () => {
    const dump = backup({ format: undefined, appVersion: undefined, kind: 'raw-dump' })
    const r = validateBackup(dump, CTX)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.file.appVersion).toBe('unknown')
    // ...but a file without the marker is still refused.
    expect(validateBackup(backup({ format: undefined }), CTX).ok).toBe(false)
  })

  it('keeps only string notes', () => {
    const r = validateBackup(backup({ notes: ['kept', 3, null] }), CTX)
    if (r.ok) expect(r.file.notes).toEqual(['kept'])
    expect(r.ok).toBe(true)
  })
})

describe('summarizeBackup', () => {
  const file = (tables: Record<string, unknown[]>, schemaVersion = 2): BackupFile => ({
    app: 'forge',
    format: 1,
    schemaVersion,
    appVersion: '0.1.0',
    exportedAt: '2026-09-22T13:30:00.000Z',
    notes: [],
    tables,
  })

  it('counts rows per table in schema order, leaving out empty tables and the settings row', () => {
    const s = summarizeBackup(
      file({
        goals: [{ id: 'g' }],
        settings: [{ id: 'app' }],
        tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        milestones: [],
      }),
      CTX,
    )
    expect(s.counts).toEqual([
      { table: 'tasks', count: 3 },
      { table: 'goals', count: 1 },
    ])
    expect(s.items).toBe(4)
    expect(s.exportedAt).toBe(Date.parse('2026-09-22T13:30:00.000Z'))
    expect(s.appVersion).toBe('0.1.0')
    expect(s.needsUpgrade).toBe(false)
  })

  it('says when the file will be upgraded', () => {
    expect(summarizeBackup(file({ tasks: [{ id: 'a' }] }, 1), CTX).needsUpgrade).toBe(true)
  })

  it('countItems ignores the settings row', () => {
    expect(countItems({ settings: [{ id: 'app' }], tasks: [{ id: 'a' }] })).toBe(1)
  })
})

describe('v1 → v2 migration', () => {
  const v1 = (): BackupFile => ({
    app: 'forge',
    format: 1,
    schemaVersion: 1,
    appVersion: '0.0.9',
    exportedAt: '2026-09-01T12:00:00.000Z',
    notes: [],
    tables: {
      settings: [{ id: 'app', scheduling: { defaultStudyStart: '20:00' } }],
      tasks: [v1Task],
      milestones: [
        {
          id: 'm1',
          goalId: 'g1',
          code: 'C182',
          title: 'Introduction to IT',
          courseType: 'OA',
          status: 'active',
          order: 0,
        },
      ],
    },
  })

  it('brings a v1 file to v2: rows mapped, new tables added, version bumped', () => {
    const out = migrateBackupV1toV2(v1(), NOW)
    expect(out.schemaVersion).toBe(2)
    expect(out.tables.tasks?.[0]).toMatchObject({
      id: 'task-1',
      doDate: '2026-09-30',
      dueDate: null,
      durationMinutes: 45,
      kind: 'study',
    })
    for (const t of ['plannedAssessments', 'planProposals', 'practiceQuestions', 'readiness']) {
      expect(out.tables[t]).toBeDefined()
    }
    expect(out.tables.plannedAssessments?.length).toBeGreaterThan(0)
  })

  it('does not change the input, and leaves a v2 file alone', () => {
    const input = v1()
    const before = structuredClone(input)
    const out = migrateBackupV1toV2(input, NOW)
    expect(input).toEqual(before)
    expect(out).not.toBe(input)
    expect(migrateBackupV1toV2(out, NOW)).toBe(out)
  })

  it('migrateBackup walks up to the target and stops there', () => {
    expect(migrateBackup(v1(), 2, NOW).schemaVersion).toBe(2)
    expect(migrateBackup(v1(), 1, NOW).schemaVersion).toBe(1)
    const newer = { ...v1(), schemaVersion: 9 }
    expect(migrateBackup(newer, 2, NOW)).toBe(newer)
  })
})

describe('planRestore', () => {
  const pdfBytes = new TextEncoder().encode('%PDF-1.7 study guide')
  const stored = (blob: unknown, id = 'f1') => ({
    id,
    createdAt: 1,
    updatedAt: 1,
    name: 'C779 study guide.pdf',
    mime: 'application/pdf',
    size: pdfBytes.length,
    blob,
  })
  const file = (rows: unknown[], schemaVersion = 2): BackupFile => ({
    app: 'forge',
    format: 1,
    schemaVersion,
    appVersion: '0.1.0',
    exportedAt: '2026-09-22T13:30:00.000Z',
    notes: [],
    tables: { tasks: [{ id: 't1' }], files: rows },
  })

  it('turns embedded files back into Blobs with their type and bytes', async () => {
    const encoded = {
      __blob: true,
      type: 'application/pdf',
      size: pdfBytes.length,
      base64: bytesToBase64(pdfBytes),
    }
    const plan = planRestore(file([stored(encoded)]), CTX, NOW)
    expect(plan.skippedFiles).toBe(0)
    const row = plan.tables.files?.[0] as { blob: Blob }
    expect(row.blob).toBeInstanceOf(Blob)
    expect(row.blob.type).toBe('application/pdf')
    expect(new Uint8Array(await row.blob.arrayBuffer())).toEqual(pdfBytes)
  })

  it('drops files whose bytes are missing or broken, and counts them', () => {
    const plan = planRestore(
      file([
        stored({ __blob: true, type: 'application/pdf', size: 20 }, 'f1'),
        stored(
          { __blob: true, type: 'application/pdf', size: 20, base64: '***not base64***' },
          'f2',
        ),
        stored('nope', 'f3'),
      ]),
      CTX,
      NOW,
    )
    expect(plan.tables.files).toEqual([])
    expect(plan.skippedFiles).toBe(3)
  })

  it('has every known table (an absent one is empty) and migrates old files', () => {
    const plan = planRestore(file([], 1), CTX, NOW)
    expect(Object.keys(plan.tables).sort()).toEqual([...CTX.knownTables].sort())
    expect(plan.tables.goals).toEqual([])
    expect(plan.tables.plannedAssessments).toEqual([])
    expect(plan.tables.tasks?.[0]).toMatchObject({ id: 't1', doDate: null, kind: 'task' })
  })

  it('leaves the file’s own rows untouched', () => {
    const input = file([])
    const before = structuredClone(input)
    planRestore(input, CTX, NOW)
    expect(input).toEqual(before)
  })
})

describe('weekly backup reminder', () => {
  const base: ReminderInput = {
    now: NOW,
    lastExportAt: NOW - 8 * DAY,
    lastRemindedAt: null,
    remindWeekly: true,
    hasData: true,
    since: NOW - 30 * DAY,
  }

  it('is due when the last export is more than 7 days old', () => {
    expect(backupReminderDue(base)).toBe(true)
  })

  it('is not due at exactly 7 days, or sooner', () => {
    expect(backupReminderDue({ ...base, lastExportAt: NOW - 7 * DAY })).toBe(false)
    expect(backupReminderDue({ ...base, lastExportAt: NOW - 7 * DAY - 1 })).toBe(true)
    expect(backupReminderDue({ ...base, lastExportAt: NOW - DAY })).toBe(false)
  })

  it('counts from the first day of use before there is an export', () => {
    expect(backupReminderDue({ ...base, lastExportAt: null })).toBe(true)
    expect(backupReminderDue({ ...base, lastExportAt: null, since: NOW - 3 * DAY })).toBe(false)
  })

  it('stays quiet without data, or with the switch off', () => {
    expect(backupReminderDue({ ...base, hasData: false })).toBe(false)
    expect(backupReminderDue({ ...base, remindWeekly: false })).toBe(false)
  })

  it('never shows twice in a week, acted on or not', () => {
    expect(backupReminderDue({ ...base, lastRemindedAt: NOW - 2 * DAY })).toBe(false)
    expect(backupReminderDue({ ...base, lastRemindedAt: NOW - 7 * DAY + 1 })).toBe(false)
    expect(backupReminderDue({ ...base, lastRemindedAt: NOW - 7 * DAY })).toBe(true)
  })

  it('exporting silences it for another week', () => {
    expect(
      backupReminderDue({ ...base, lastExportAt: NOW - 1000, lastRemindedAt: NOW - 20 * DAY }),
    ).toBe(false)
  })

  it('hasUserData looks at what a person fills, not at seeded rows', () => {
    expect(hasUserData({})).toBe(false)
    expect(hasUserData({ blocklist: 11, rewards: 3, settings: 1, xpEvents: 0 })).toBe(false)
    expect(hasUserData({ blocklist: 11, tasks: 1 })).toBe(true)
    expect(hasUserData({ goals: 1 })).toBe(true)
  })

  it('describes the age of the last backup in calendar days', () => {
    expect(backupAgeLabel(null, NOW)).toBe('Never')
    expect(backupAgeLabel(NOW - 60_000, NOW)).toBe('Today')
    expect(backupAgeLabel(new Date(2026, 8, 28, 23, 59).getTime(), NOW)).toBe('Yesterday')
    expect(backupAgeLabel(NOW - 5 * DAY, NOW)).toBe('5 days ago')
  })
})

describe('typed reset', () => {
  it('accepts the phrase, ignoring case and surrounding spaces', () => {
    expect(RESET_PHRASE).toBe('reset forge')
    expect(isResetPhrase('reset forge')).toBe(true)
    expect(isResetPhrase('  Reset Forge ')).toBe(true)
  })

  it('rejects anything else', () => {
    for (const s of ['', 'reset', 'reset  forge', 'reset forge!', 'forge reset', 'resetforge']) {
      expect(isResetPhrase(s)).toBe(false)
    }
  })
})
