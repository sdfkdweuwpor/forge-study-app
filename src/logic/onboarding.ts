/**
 * Onboarding rules (BRIEF §5.10), pure: whether the first-launch flow should show, what the daily-goal
 * stepper says, and how the distracting-sites step turns a person's picks into blocklist changes. Nothing
 * here reads a clock or the database; the onboarding feature feeds it and applies the result.
 */
import type { BlocklistEntry, ID } from '@/db/types'
import { checkBlockDomain, normalizeBlockDomain, type Checked } from './blocker'

// ─── The gate ───────────────────────────────────────────────────────────────
// Kept in `onboardingGate.ts` so the app shell does not load the rest of this file; re-exported here.

export { WELCOME_PATH, gateDecision, isSyncSetupPath, isWelcomePath } from './onboardingGate'
export type { GateDecision, GateInput } from './onboardingGate'

// ─── Steps ──────────────────────────────────────────────────────────────────

export const STEP_COUNT = 4
export type OnboardingStep = 0 | 1 | 2 | 3

export const STEP_NAMES: readonly string[] = [
  'About you',
  'Distractions',
  'First goal',
  'Extension',
]

/** The step after `step`, or `null` after the last one. */
export function nextStep(step: OnboardingStep): OnboardingStep | null {
  return step >= STEP_COUNT - 1 ? null : ((step + 1) as OnboardingStep)
}

/** The step before `step`, or `null` before the first one. */
export function previousStep(step: OnboardingStep): OnboardingStep | null {
  return step <= 0 ? null : ((step - 1) as OnboardingStep)
}

// ─── Name and daily goal ────────────────────────────────────────────────────

export const NAME_MAX = 40
export const DAILY_GOAL_MIN = 1
export const DAILY_GOAL_MAX = 16
export const DAILY_GOAL_DEFAULT = 6

/** A name as it is stored: trimmed, inner spaces collapsed, no longer than `NAME_MAX`. */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim()
}

/** Pomodoros per day kept between `DAILY_GOAL_MIN` and `DAILY_GOAL_MAX`; anything else is the default. */
export function clampDailyGoal(value: number): number {
  if (!Number.isFinite(value)) return DAILY_GOAL_DEFAULT
  return Math.min(DAILY_GOAL_MAX, Math.max(DAILY_GOAL_MIN, Math.round(value)))
}

/** "≈ 2.5 h of focus" for 6 pomodoros of 25 minutes; minutes under an hour ("≈ 25 min of focus"). */
export function focusHint(pomodoros: number, pomodoroMin: number): string {
  const minutes = Math.max(0, Math.round(pomodoros)) * Math.max(0, pomodoroMin)
  if (minutes < 60) return `≈ ${minutes} min of focus`
  const hours = Math.round((minutes / 60) * 10) / 10
  return `≈ ${Number.isInteger(hours) ? hours : hours.toFixed(1)} h of focus`
}

// ─── Distracting sites ──────────────────────────────────────────────────────

export interface SiteChip {
  domain: string
  selected: boolean
  /** Not one of the eleven defaults: added by the person. */
  custom: boolean
}

type SiteRow = Pick<BlocklistEntry, 'id' | 'kind' | 'domain' | 'enabled'>

/**
 * The chips for the step: every default in its usual order (picked when it is on the list and switched
 * on), then the other sites already on the list, all picked.
 */
export function initialChips(rows: readonly SiteRow[], defaults: readonly string[]): SiteChip[] {
  const blocked = rows.filter((r) => r.kind === 'block')
  const on = new Set(blocked.filter((r) => r.enabled).map((r) => r.domain))
  const isDefault = new Set(defaults)
  return [
    ...defaults.map((domain) => ({ domain, selected: on.has(domain), custom: false })),
    ...blocked
      .filter((r) => !isDefault.has(r.domain))
      .map((r) => ({ domain: r.domain, selected: r.enabled, custom: true })),
  ]
}

export function toggleChip(chips: readonly SiteChip[], domain: string): SiteChip[] {
  return chips.map((c) => (c.domain === domain ? { ...c, selected: !c.selected } : c))
}

export function selectedDomains(chips: readonly SiteChip[]): string[] {
  return chips.filter((c) => c.selected).map((c) => c.domain)
}

/** What typing a site into the add field does. */
export type AddSiteResult =
  /** Not on the list at all: a new custom chip. */
  | { kind: 'add'; domain: string }
  /** Already a chip that was switched off: pick it again instead of complaining. */
  | { kind: 'select'; domain: string }
  | { kind: 'error'; message: string }

export function checkNewSite(raw: string, chips: readonly SiteChip[]): AddSiteResult {
  const domain = normalizeBlockDomain(raw)
  if (domain !== null) {
    const same = chips.find((c) => c.domain === domain)
    if (same && !same.selected) return { kind: 'select', domain }
  }
  // Only the picked sites count: a switched-off chip neither repeats nor covers what is typed.
  const rows = chips.filter((c) => c.selected).map((c) => ({ domain: c.domain, enabled: true }))
  const checked: Checked<string> = checkBlockDomain(raw, rows)
  return checked.ok
    ? { kind: 'add', domain: checked.value }
    : { kind: 'error', message: checked.message }
}

export function addChip(chips: readonly SiteChip[], result: AddSiteResult): SiteChip[] {
  if (result.kind === 'error') return [...chips]
  if (result.kind === 'select') {
    return chips.map((c) => (c.domain === result.domain ? { ...c, selected: true } : c))
  }
  return [...chips, { domain: result.domain, selected: true, custom: true }]
}

export interface BlocklistPlan {
  /** Domains to add as new rows. */
  add: string[]
  /** Rows to delete: sites that are on the list and were switched off in the step. */
  remove: ID[]
  /** Rows that exist but were switched off elsewhere and are picked here. */
  enable: ID[]
}

/**
 * The changes that make the blocklist match the picks. Allowlist exceptions are never touched. Applying
 * the same plan twice changes nothing the second time (the rows it names are already right).
 */
export function planBlocklist(rows: readonly SiteRow[], chips: readonly SiteChip[]): BlocklistPlan {
  const picked = new Set(selectedDomains(chips))
  const blocked = rows.filter((r) => r.kind === 'block')
  const have = new Set(blocked.map((r) => r.domain))
  return {
    add: [...picked].filter((d) => !have.has(d)),
    remove: blocked.filter((r) => !picked.has(r.domain)).map((r) => r.id),
    enable: blocked.filter((r) => picked.has(r.domain) && !r.enabled).map((r) => r.id),
  }
}

export function isEmptyPlan(plan: BlocklistPlan): boolean {
  return plan.add.length === 0 && plan.remove.length === 0 && plan.enable.length === 0
}

// ─── First goal ─────────────────────────────────────────────────────────────

/** What the person picked on the goal step. */
export type GoalChoice = 'wgu' | 'other' | 'none'

/** The planner template a choice starts from, or `null` for a blank goal or none. */
export function choiceTemplate(choice: GoalChoice): 'wgu-term' | null {
  return choice === 'wgu' ? 'wgu-term' : null
}
