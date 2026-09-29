# Schema migrations

Forge stores everything in one IndexedDB database, `forge`, through Dexie (`src/db/db.ts`).
Schema **v1** (`STORES_V1` in `src/db/schema.ts`) defines all 26 tables up front, so most
later phases never need a migration. When one is needed, follow this recipe exactly.

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
6. Timestamps: upgrade code that rewrites rows should keep `createdAt`/`updatedAt` unless the
   row's meaning really changed. The `updating` hook stamps `updatedAt` automatically on
   `modify()`; pass `updatedAt` explicitly to keep it.

## Adding version N

```ts
// src/db/migrations/v2.ts
import type { Transaction } from 'dexie'

/** Only tables whose schema changes. `null` deletes a table. */
export const STORES_V2_DELTA = {
  tasks: 'id, status, dueDate, completedDay, goalId, milestoneId, unitId, scheduleKey, seriesId, *tags, [status+dueDate], [goalId+status], energy',
} as const

export async function upgradeV2(tx: Transaction): Promise<void> {
  await tx.table('tasks').toCollection().modify((t: { energy?: number | null }) => {
    t.energy ??= null
  })
}
```

```ts
// src/db/db.ts, in the ForgeDB constructor, below version(1)
this.version(1).stores(STORES_V1)
this.version(2).stores(STORES_V2_DELTA).upgrade(upgradeV2)
```

Then:

- Bump `SCHEMA_VERSION` in `src/db/schema.ts`, and update `TableName`/`TABLE_NAMES` if tables
  were added or removed (keep `TableRows` in `types.ts` in sync; a type-level check enforces it).
- Update the row interfaces in `src/db/types.ts`. New fields on existing rows should be optional
  or defaulted in the upgrade so old rows stay valid.
- Add `migrateBackupV1toV2()` to `src/logic/backup.ts` and a test that imports a v1 backup fixture.
- If a **settings** field is added, just add it to `defaultSettingsData()` in `defaults.ts`:
  `ensureSettings()` backfills missing keys at boot, so no Dexie migration is needed.
- Add a dated bullet to `DECISIONS.md` describing the change and why.

## Test template

```ts
import Dexie from 'dexie'
import { ForgeDB } from '@/db/db'
import { STORES_V1 } from '@/db/schema'

it('upgrades v1 → v2', async () => {
  const name = 'forge-migration-v2'
  const v1 = new Dexie(name)
  v1.version(1).stores(STORES_V1)
  await v1.table('tasks').add({ id: 't1', title: 'Old', createdAt: 1, updatedAt: 1 /* … */ })
  v1.close()

  const db = new ForgeDB(name) // declares every version up to the latest
  const t = await db.tasks.get('t1')
  expect(t).toMatchObject({ energy: null, createdAt: 1 })
  await db.delete()
})
```

## Multi-tab safety

Dexie closes an open connection when another tab upgrades the schema (`versionchange`). The app
shell should listen for `db.on('versionchange')` and show a "Forge was updated — reload" toast
instead of failing silently.
