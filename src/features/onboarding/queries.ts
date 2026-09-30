/**
 * Reads onboarding needs. This is the one file in the feature that may import the Dexie instance.
 */
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'

/** Whether anything the person made exists: a task or a goal (starter tasks count, they are theirs now). */
export async function hasUserData(): Promise<boolean> {
  const [tasks, goals] = await Promise.all([db.tasks.count(), db.goals.count()])
  return tasks > 0 || goals > 0
}

/**
 * Live answer to `hasUserData`, or `undefined` while it is not known. With `enabled` false it answers
 * `false` at once without reading anything (the gate only needs it before the first onboarding). When
 * `enabled` turns true the hook is `undefined` again until the database has answered, never the
 * leftover `false`.
 */
export function useHasUserData(enabled: boolean): boolean | undefined {
  // The disabled run answers `null`, not `false`: after `enabled` flips, a leftover `null` is not an answer.
  const answer = useLiveQuery(async () => (enabled ? hasUserData() : null), [enabled])
  if (!enabled) return false
  return typeof answer === 'boolean' ? answer : undefined
}

/** Whether the starter tasks were added before (they keep `source: 'onboarding'` whatever happens to them). */
export async function hasStarterTasks(): Promise<boolean> {
  return (await db.tasks.filter((t) => t.source === 'onboarding').count()) > 0
}
