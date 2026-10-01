/**
 * The first-launch gate's rule (BRIEF §5.10), pure. It lives apart from `onboarding.ts` because the gate
 * wraps the whole app and is in the first download; the rest of the onboarding rules (blocklist picks,
 * steps, daily-goal stepper) are only for the welcome page and must not come along.
 */
import type { Millis } from '@/db/types'

// ─── The gate ───────────────────────────────────────────────────────────────

/** The path of the full-page onboarding route. */
export const WELCOME_PATH = '/welcome'

export function isWelcomePath(pathname: string): boolean {
  return pathname === WELCOME_PATH || pathname === `${WELCOME_PATH}/`
}

/**
 * Where someone who already uses Forge elsewhere sets up sync before any data exists (PLAN §4.7.7). The
 * gate lets a first launch stay here, and the magic link lands here.
 */
export function isSyncSetupPath(pathname: string): boolean {
  return pathname === '/settings/sync' || pathname === '/settings/sync/'
}

export interface GateInput {
  /** `undefined` while settings are loading; `null` when the person has never been through onboarding. */
  onboardedAt: Millis | null | undefined
  /** Whether any task or goal exists. `undefined` while it is being checked. */
  hasData: boolean | undefined
  pathname: string
  /** A test build asked to skip the gate (`localPrefs.skipOnboarding`). */
  bypass: boolean
}

/**
 * - `wait`: not enough is known yet; render nothing rather than flash the wrong page.
 * - `pass`: render the app as it is.
 * - `redirect`: first launch on an empty database: go to `/welcome`.
 * - `mark`: someone with data who was never onboarded (an update, an import): record it silently and
 *   render the app; they never see the flow.
 */
export type GateDecision = 'wait' | 'pass' | 'redirect' | 'mark'

export function gateDecision({ onboardedAt, hasData, pathname, bypass }: GateInput): GateDecision {
  if (bypass) return 'pass'
  if (onboardedAt === undefined) return 'wait'
  if (onboardedAt !== null) return 'pass'
  if (hasData === undefined) return 'wait'
  const onWelcome = isWelcomePath(pathname) || isSyncSetupPath(pathname)
  if (hasData) return onWelcome ? 'pass' : 'mark'
  return onWelcome ? 'pass' : 'redirect'
}
