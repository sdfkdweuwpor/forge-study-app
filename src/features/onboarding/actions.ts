/**
 * What the onboarding steps write. Every function here is safe to run twice: the blocklist plan is
 * computed from what is stored now, the starter tasks are added once, and `onboardedAt` is only set
 * while it is empty.
 */
import {
  addBlockedDomain,
  BlocklistInputError,
  listBlocklist,
  removeBlocklistEntry,
  seedDefaultBlocklist,
  setBlocklistEntryEnabled,
} from '@/db/repos/blocker'
import { getSettings, updateSettings } from '@/db/repos/settings'
import { createTask } from '@/db/repos/tasks'
import type { BlocklistEntry, ISODate, Millis } from '@/db/types'
import { buildOnboardingTasks } from '@/data/sample/onboardingTasks'
import { clampDailyGoal, cleanName, planBlocklist, type SiteChip } from '@/logic/onboarding'
import { hasStarterTasks } from './queries'

/** Step 1: the name and the daily goal, in the settings. */
export async function saveProfile(input: { name: string; dailyGoal: number }): Promise<void> {
  await updateSettings({
    profile: { name: cleanName(input.name) },
    dailyGoalPomodoros: clampDailyGoal(input.dailyGoal),
  })
}

/** Step 2: the rows the chips start from. The default list is added first when it has not been yet. */
export async function loadBlocklist(): Promise<BlocklistEntry[]> {
  await seedDefaultBlocklist()
  return listBlocklist()
}

/** Step 2: makes the blocklist match the chips. The Blocker sync pushes the result to the extension. */
export async function saveBlocklist(chips: readonly SiteChip[]): Promise<void> {
  const plan = planBlocklist(await listBlocklist(), chips)
  for (const id of plan.remove) await removeBlocklistEntry(id)
  for (const id of plan.enable) await setBlocklistEntryEnabled(id, true)
  for (const domain of plan.add) {
    try {
      await addBlockedDomain(domain)
    } catch (e) {
      // A site the list already covers (or has as a repeat) is what the person wanted anyway.
      if (!(e instanceof BlocklistInputError)) throw e
    }
  }
}

/** Adds the three starter tasks unless they were added before. Returns how many it added. */
export async function addStarterTasks(today: ISODate, now: Millis): Promise<number> {
  if (await hasStarterTasks()) return 0
  const inputs = buildOnboardingTasks(today)
  for (const [i, input] of inputs.entries()) {
    // One millisecond apart keeps their order in every list that sorts by creation.
    await createTask(input, { now: now + i })
  }
  return inputs.length
}

/** Records that onboarding is done. The first time wins: replaying it never moves the date. */
export async function markOnboarded(now: Millis): Promise<void> {
  if ((await getSettings()).onboardedAt === null) await updateSettings({ onboardedAt: now })
}

/**
 * The end of the flow. On the first run it also leaves the starter tasks on Today. Replaying onboarding
 * only records what was chosen and adds nothing.
 */
export async function finishOnboarding(input: {
  firstRun: boolean
  today: ISODate
  now: Millis
}): Promise<{ starterTasks: number }> {
  const starterTasks = input.firstRun ? await addStarterTasks(input.today, input.now) : 0
  await markOnboarded(input.now)
  return { starterTasks }
}
