// Pin the time zone before anything reads a date: formatted times ("9:30 AM") and local-midnight days in the
// tests assume US Eastern, whatever machine or CI runs them (`npm test` sets TZ too, this covers `npx vitest`).
process.env.TZ = 'America/New_York'

// Provides a real IndexedDB implementation (indexedDB, IDBKeyRange, …) on globalThis for Dexie tests.
import 'fake-indexeddb/auto'
