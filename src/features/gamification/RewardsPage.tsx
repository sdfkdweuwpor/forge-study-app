/**
 * `/rewards/:tab?`: the rewards shop (BRIEF §5.5). Three tabs: Shop (the balance and the rewards you can
 * buy), Badges (6C's grid) and History (what you redeemed). The page owns the "new reward" row's open
 * state so `n`, the palette and the empty state all open the same row.
 */
import { Award } from 'lucide-react'
import { Suspense, lazy, useCallback, useEffect, useState, type ComponentType } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { recordError } from '@/app/reportError'
import { Slot, useSlotCount } from '@/app/registry'
import { navigate, setQuery, useParams, useQuery } from '@/app/router'
import { useShortcutHandler, useShortcutScope } from '@/app/shortcuts'
import { seedStarterRewards } from '@/db/repos/rewards'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import { Tabs, type TabItem } from '@/ui/Tabs'
import { RedemptionHistory } from './RedemptionHistory'
import { RewardsError, RewardsSkeleton } from './RewardsStates'
import { RewardsShop } from './RewardsShop'
import styles from './RewardsPage.module.css'

export type RewardsTab = 'shop' | 'badges' | 'history'

const TABS: readonly TabItem<RewardsTab>[] = [
  { value: 'shop', label: 'Shop' },
  { value: 'badges', label: 'Badges' },
  { value: 'history', label: 'History' },
]

export function tabFromParam(param: string | undefined): RewardsTab {
  return param === 'badges' || param === 'history' ? param : 'shop'
}

/** The Badges grid is 6C's, in its own file. Until that file exists the tab says so instead of failing. */
type BadgesModule = { BadgesGrid?: ComponentType; default?: ComponentType }
const badgeLoaders = import.meta.glob<BadgesModule>('./BadgesGrid.tsx')
const loadBadges = badgeLoaders['./BadgesGrid.tsx']

function BadgesPlaceholder() {
  return (
    <EmptyState
      titleAs="h2"
      icon={<Award />}
      title="Badges are on their way"
      description="First Focus, Early Bird, 7-Day Streak and the rest will collect here as you earn them."
    />
  )
}

const BadgesGrid: ComponentType = loadBadges
  ? lazy(async () => {
      const mod = await loadBadges()
      return { default: mod.BadgesGrid ?? mod.default ?? BadgesPlaceholder }
    })
  : BadgesPlaceholder

function BadgesTab() {
  // Another part may add its own badge UI through the slot instead of the grid file.
  const slotted = useSlotCount('rewards.tabs')
  return (
    <ErrorBoundary fallback={(_e, reset) => <RewardsError what="badges" onRetry={reset} />}>
      <Suspense fallback={<Skeleton variant="block" height={160} />}>
        {loadBadges || slotted === 0 ? <BadgesGrid /> : <Slot id="rewards.tabs" />}
      </Suspense>
    </ErrorBoundary>
  )
}

/** Offers the starter rewards once, then reports when the shop may render (so it never flashes empty). */
function useStarterRewards(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    seedStarterRewards()
      .catch((e: unknown) => recordError(e, 'rewards.seed'))
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [])
  return ready
}

function RewardsScreen() {
  const tab = tabFromParam(useParams<'rewards'>().tab)
  const ready = useStarterRewards()
  // The New reward row is open while the address says `?new=1`: `n`, the palette and the empty state
  // all set it, so they open the same row, and a reload keeps it. Closing removes it (no history entry).
  const creating = useQuery().new === '1'
  const setCreating = useCallback((open: boolean) => setQuery({ new: open ? '1' : undefined }), [])

  const openNew = useCallback(() => {
    if (tab === 'shop') setCreating(true)
    else navigate('rewards', { tab: 'shop' }, { query: { new: '1' } })
  }, [tab, setCreating])

  useShortcutScope('rewards')
  useShortcutHandler('rewards.new', openNew)

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Rewards</h1>
      </header>
      <Tabs
        label="Rewards sections"
        items={TABS}
        value={tab}
        onValueChange={(next) => navigate('rewards', { tab: next })}
      >
        {(value) => (
          <div className={styles.panel}>
            {value === 'shop' ? (
              ready ? (
                <RewardsShop creating={creating} onCreatingChange={setCreating} />
              ) : (
                <RewardsSkeleton />
              )
            ) : value === 'badges' ? (
              <BadgesTab />
            ) : (
              <RedemptionHistory />
            )}
          </div>
        )}
      </Tabs>
    </div>
  )
}

export default function RewardsPage() {
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <div className={styles.root}>
          <header className={styles.header}>
            <h1 className={styles.heading}>Rewards</h1>
          </header>
          <RewardsError onRetry={reset} />
        </div>
      )}
    >
      <RewardsScreen />
    </ErrorBoundary>
  )
}
