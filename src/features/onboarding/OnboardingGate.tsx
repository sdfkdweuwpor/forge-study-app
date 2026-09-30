import { useEffect, type ReactNode } from 'react'
import { recordError } from '@/app/reportError'
import { navigate, usePathname } from '@/app/router'
import { useSettings } from '@/db/hooks/useSettings'
import { getSettings } from '@/db/repos/settings'
import { gateDecision } from '@/logic/onboardingGate'
import { PREF_KEYS, readPref } from '@/lib/localPrefs'
import { syncIsOn, useHasUserData } from './queries'

/**
 * Test builds (`VITE_ENABLE_SEED=1`: dev, Playwright) can switch the gate off with a device pref, so a
 * spec that starts on an empty database does not land on the welcome page. A deployed build compiles
 * the whole check away.
 */
const BYPASS_ENABLED = import.meta.env.VITE_ENABLE_SEED === '1'
const bypassRequested = (): boolean => BYPASS_ENABLED && readPref(PREF_KEYS.skipOnboarding) === '1'

/**
 * The first-launch gate (BRIEF §5.10). It wraps the whole app:
 * - a first launch on an empty database goes to `/welcome`;
 * - someone who has data but was never onboarded (an update, an import) is marked onboarded, silently;
 * - everyone else sees the app as usual.
 * Until it knows which of these applies it renders nothing, so the wrong page never flashes.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const settings = useSettings()
  const pathname = usePathname()
  const bypass = bypassRequested() || syncIsOn()
  const onboardedAt = settings?.onboardedAt
  // Looking for data is only needed while onboarding has not happened.
  const hasData = useHasUserData(onboardedAt === null && !bypass)
  const decision = gateDecision({ onboardedAt, hasData, pathname, bypass })

  useEffect(() => {
    if (decision === 'mark') {
      // The writer (and the sample-task code beside it) loads only for the rare person who needs it.
      import('./actions')
        .then(({ markOnboarded }) => markOnboarded(Date.now()))
        .catch((e: unknown) => recordError(e, 'onboarding.gate'))
    }
    if (decision !== 'redirect') return undefined
    // A page that has just finished onboarding writes the date and then navigates; this component's
    // copy of the settings may be a moment behind. Ask the database before sending anyone back.
    let alive = true
    getSettings()
      .then((fresh) => {
        if (alive && fresh.onboardedAt === null) navigate('welcome', undefined, { replace: true })
      })
      .catch((e: unknown) => recordError(e, 'onboarding.gate'))
    return () => {
      alive = false
    }
  }, [decision])

  if (decision === 'wait' || decision === 'redirect') return null
  return <>{children}</>
}
