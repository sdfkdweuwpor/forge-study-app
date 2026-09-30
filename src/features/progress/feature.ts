import type { FeatureManifest } from '@/app/registry'

/**
 * Progress (Phase 7): streaks (7A), the Progress page and its charts (7B) and the weekly review (7C)
 * are one feature folder and one manifest. Each part registers itself, so nobody edits this file to
 * add theirs.
 *
 * HOW TO ADD YOUR PART (7B, 7C)
 * Create `src/features/progress/<Name>.feature.ts` (7A: `Streaks.feature.ts`, 7B:
 * `ProgressPage.feature.ts`, 7C: `WeeklyReview.feature.ts`) with a default export of a
 * `FeatureContribution`. Every `*.feature.ts` in this folder is picked up and merged below, so there
 * is no import to add here and nothing breaks while a part does not exist yet:
 *
 *     import { lazy } from 'react'
 *     import type { FeatureContribution } from './feature'
 *
 *     const feature: FeatureContribution = {
 *       routes: { progress: lazy(() => import('./ProgressPage')) },      // 7B: `/progress`
 *       // routes: { weeklyReview: lazy(() => import('./WeeklyReviewPage')) }, // 7C: `/review/:weekStart?`
 *       slots: [{ slot: 'progress.sections', id: 'progress.sections.year', order: 10, component: X }],
 *       domainHandlers: [myHandler],
 *       onAppStart: async ({ today }) => { … },                          // reconcile from history
 *       commands: [], shortcuts: [], search: [], providers: [],
 *     }
 *     export default feature
 *
 * Rules: use `import type` from `./feature` (a value import would be circular); ids of commands,
 * shortcuts and slot contributions must be unique across the whole app (`registry.test.ts` checks it),
 * so prefix them with your part (`streaks.…`, `progressPage.…`, `weeklyReview.…`). A route is
 * registered once, by whoever owns the page (`progress` by 7B, `weeklyReview` by 7C). Every part's
 * `onAppStart` runs; a part that throws does not stop the others.
 *
 * Other features import from `@/features/progress` (`index.ts`) only. Streak data for pages comes
 * from `useStreak()` (`@/db/hooks/useStreak`), never from this folder.
 */
export type FeatureContribution = Omit<FeatureManifest, 'id'>

const parts = import.meta.glob<FeatureContribution>('./*.feature.ts', {
  eager: true,
  import: 'default',
})

/** Contributions in file-name order, so the merged manifest is the same on every build. */
export const contributions: readonly FeatureContribution[] = Object.entries(parts)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, part]) => part)

/** Merges parts into one manifest: lists concatenate, routes combine, `onAppStart` hooks all run. */
export function mergeContributions(
  id: string,
  list: readonly FeatureContribution[],
): FeatureManifest {
  const starts = list.flatMap((c) => (c.onAppStart ? [c.onAppStart] : []))
  return {
    id,
    routes: Object.assign({}, ...list.map((c) => c.routes ?? {})) as FeatureManifest['routes'],
    commands: list.flatMap((c) => c.commands ?? []),
    shortcuts: list.flatMap((c) => c.shortcuts ?? []),
    search: list.flatMap((c) => c.search ?? []),
    slots: list.flatMap((c) => c.slots ?? []),
    providers: list.flatMap((c) => c.providers ?? []),
    domainHandlers: list.flatMap((c) => c.domainHandlers ?? []),
    onAppStart:
      starts.length === 0
        ? undefined
        : async (ctx) => {
            const results = await Promise.allSettled(starts.map((start) => start(ctx)))
            const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
            if (failed) throw failed.reason
          },
  }
}

const manifest: FeatureManifest = mergeContributions('progress', contributions)

export default manifest
