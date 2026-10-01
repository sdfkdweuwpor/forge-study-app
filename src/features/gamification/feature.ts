import type { FeatureManifest } from '@/app/registry'

/**
 * Gamification (Phase 6): XP and levels (6A), the rewards shop (6B) and badges (6C) are one feature
 * folder and one manifest. Each part registers itself, so nobody edits this file to add theirs.
 *
 * HOW TO ADD YOUR PART (6B, 6C)
 * Create `src/features/gamification/<Name>.feature.ts` (6B: `Rewards.feature.ts`, 6C:
 * `Badges.feature.ts`) with a default export of a `FeatureContribution`. Every `*.feature.ts` in this
 * folder is picked up and merged below, so there is no import to add here and nothing breaks while
 * a part does not exist yet:
 *
 *     import { lazy } from 'react'
 *     import type { FeatureContribution } from './feature'
 *
 *     const feature: FeatureContribution = {
 *       routes: { rewards: lazy(() => import('./RewardsPage')) }, // `/rewards/:tab?`
 *       slots: [{ slot: 'rewards.tabs', id: 'rewards.badges', order: 20, component: BadgesTab }],
 *       domainHandlers: [myHandler],
 *       onAppStart: async ({ today }) => { … },                    // reconcile from history
 *       commands: [], shortcuts: [], search: [], providers: [],
 *     }
 *     export default feature
 *
 * Rules: use `import type` from `./feature` (a value import would be circular); ids of commands,
 * shortcuts and slot contributions must be unique across the whole app (`registry.test.ts` checks it),
 * so prefix them with your part (`rewards.…`, `badges.…`). Route `rewards` is registered once, by
 * whoever owns the page (6B); 6A only adds the palette command that links to it. Every part's
 * `onAppStart` runs; a part that throws does not stop the others.
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

const manifest: FeatureManifest = mergeContributions('gamification', contributions)

export default manifest
