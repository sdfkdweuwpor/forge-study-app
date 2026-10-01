# Schema migrations

Forge stores everything in one IndexedDB database, `forge`, through Dexie (`src/db/db.ts`).
Schema **v1** (`STORES_V1` in `src/db/schema.ts`) defined 26 tables up front. **v2** (the Goal
Breakdown Planner, PLAN §4.6) is `v2.ts`; **v3** (cloud sync, PLAN §4.7.4) is `v3.ts`. `STORES` in `schema.ts` is v1 with every later delta
applied; `TableName` and `TABLE_NAMES` come from it. When a new version is needed, follow this
recipe exactly.

## Versions

| Version | File | What changed |
|---|---|---|
| 1 | `schema.ts` (`STORES_V1`) | Every table of PLAN §3. |
| 2 | `v2.ts` (`STORES_V2_DELTA`, `upgradeV2`) | Tasks: `doDate`/`doTime`/`durationMinutes`, `autoSlot`, `kind`, `assessmentId`, `sync` (indexes `doDate`, `[status+doDate]`, `kind`, `assessmentId`, `[goalId+kind]`); sessions: `[goalId+day]`; goals: `planning`; units and courses: self-rating and estimate metadata; flashcards: `scheduler`, `fsrs`, `noteRef`; new tables `plannedAssessments`, `planProposals`, `practiceQuestions`, `questionAttempts`, `readiness`. The v1 date moves to `doDate` (`dueDate` = a real deadline only); WGU courses get undated planned OAs/PAs; trash payloads are mapped too. |
| 3 | `v3.ts` (`STORES_V3_DELTA`, `upgradeV3`) | New tables `syncOutbox` (`[tbl+id], at`: one entry per record changed since the last push) and `syncState` (`id`: this device's sync config and bookkeeping). The settings row loses `sync` (moved to `syncState`). Neither new table is ever in a backup; `migrateBackupV2toV3` strips `settings.sync`. |

The row mapping of each version is **pure** and lives in `src/logic/schemaV<N>.ts`, so the Dexie
upgrade and the backup migrator (`src/logic/backup.ts`, `migrateBackupV1toV2`) share it. Every
mapping is idempotent (a row that already has the new fields keeps them).

## Rules

1. **Released version strings are append-only.** Never edit `STORES_V1` (or any `STORES_Vn`
   that has shipped). Users' browsers hold databases created from it.
2. **One file per version:** `src/db/migrations/vN.ts`.
3. **Every migration has a fake-indexeddb test** that opens a v(N-1) database seeded with a
   fixture, reopens it at vN and asserts the upgraded rows.
4. **Old backups must keep importing.** Each version also gets a pure backup-file migrator in
   `src/logic/backup.ts` (`migrateBackupV(N-1)toVN`), because JSON exports and in-DB snapshots
   carry their `schemaVersion`.
5. **Never index booleans, `null` or `undefined`** (IndexedDB can't key them). Nullable fields
   simply drop out of their index.
6. Timestamps: an upgrade is not an edit. The `updating` hook in `db.ts` does not stamp rows
   inside the native `versionchange` transaction (Dexie wraps it in a `'readwrite'` transaction,
   so the hook checks `tx.idbtrans.mode`), so `modify()` in an upgrader keeps `updatedAt`. Set it
   yourself only when the row's meaning really changed. An upgrade is never queued for cloud sync
   either: upgrade transactions do not pass through the tracking middleware's `transaction()`.
   Write an upgrader so that running it again touches nothing (`filter` before `modify`).
7. **Trash payloads hold old rows.** Map them in the upgrade too, or restoring a trashed row after
   the upgrade brings back an old-shaped row (`trashToV2` does this for v2).

## Adding version N (the v2 file is the worked example)

```ts
// src/db/migrations/v3.ts (sketch)
import type { Transaction } from 'dexie'

/** Only tables whose schema changes. `null` deletes a table. */
export const STORES_V3_DELTA = {
  tasks: '<the whole v2 tasks string>, energy',
} as const

export async function upgradeV3(tx: Transaction): Promise<void> {
  await tx.table('tasks').toCollection().modify((t: { energy?: number | null }) => {
    t.energy ??= null
  })
}
```

```ts
// src/db/db.ts, in the ForgeDB constructor, below the last version
this.version(2).stores(STORES_V2_DELTA).upgrade((tx) => upgradeV2(tx, clock()))
this.version(3).stores(STORES_V3_DELTA).upgrade(upgradeV3)
```

Then:

- Bump `SCHEMA_VERSION` in `src/db/schema.ts` and spread the new delta into `STORES` (that keeps
  `TableName`/`TABLE_NAMES` right; keep `TableRows` in `types.ts` in sync, a type-level check
  enforces it).
- Update the row interfaces in `src/db/types.ts`. New fields on existing rows are filled by the
  upgrade (v2 made them non-optional).
- Add `migrateBackupV2toV3()` to `src/logic/backup.ts` (and a step in `migrateBackup`) and a test
  that imports a v2 backup fixture.
- Add the new tables to `trashTables()` and the goal/course cascade in `repos/trash.ts` when they
  belong to a goal.
- If a **settings** field is added, just add it to `defaultSettingsData()` in `defaults.ts`:
  `ensureSettings()` backfills missing keys at boot, so no Dexie migration is needed.
- Add a dated bullet to `DECISIONS.md` describing the change and why.

## Test template

`v2.test.ts` is the model: it seeds a v1 database (declared with `new Dexie(name)` and only
`version(1).stores(STORES_V1)`) with the WGU sample as v1 rows, closes it, opens `new ForgeDB(name,
clock)` (which declares every version) and asserts the upgraded rows, that timestamps are kept,
that running the upgrade again changes nothing, that the settings defaults fill in, that trashed
rows come back new-shaped, and that `migrateBackupV1toV2` of the same v1 tables equals what the
database holds.

## Multi-tab safety

Dexie closes an open connection when another tab upgrades the schema (`versionchange`). The app
shell should listen for `db.on('versionchange')` and show a "Forge was updated — reload" toast
instead of failing silently.
