import {
  Building2,
  CalendarDays,
  CircleCheckBig,
  Ellipsis,
  Gift,
  Inbox,
  List,
  ListChecks,
  Settings,
  Shield,
  Sun,
  Target,
  Timer,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import type { RouteName } from '../router/routes'

/** Routes whose params are all optional, so a nav link needs none. */
export type NavRoute =
  'today' | 'focus' | 'tasks' | 'goals' | 'world' | 'progress' | 'rewards' | 'blocker' | 'settings'

export interface NavItem {
  id: string
  label: string
  icon: LucideIcon
  to: NavRoute
  /** Route names that keep this item highlighted. */
  match: readonly RouteName[]
  /** "Go to" sequence shown as a faint hint, e.g. 'g t'. */
  goto?: string
}

export const NAV: Record<string, NavItem> = {
  today: { id: 'today', label: 'Today', icon: Sun, to: 'today', match: ['today'], goto: 'g t' },
  focus: { id: 'focus', label: 'Focus', icon: Timer, to: 'focus', match: ['focus'], goto: 'g f' },
  tasks: {
    id: 'tasks',
    label: 'Tasks',
    icon: ListChecks,
    to: 'tasks',
    match: ['tasks', 'taskView', 'task'],
    goto: 'g i',
  },
  goals: {
    id: 'goals',
    label: 'Goals',
    icon: Target,
    to: 'goals',
    match: ['goals', 'goalNew', 'goal', 'course', 'cardReview'],
    goto: 'g g',
  },
  world: {
    id: 'world',
    label: 'My World',
    icon: Building2,
    to: 'world',
    match: ['world'],
    goto: 'g w',
  },
  progress: {
    id: 'progress',
    label: 'Progress',
    icon: TrendingUp,
    to: 'progress',
    match: ['progress', 'weeklyReview'],
    goto: 'g p',
  },
  rewards: {
    id: 'rewards',
    label: 'Rewards',
    icon: Gift,
    to: 'rewards',
    match: ['rewards'],
    goto: 'g r',
  },
  blocker: {
    id: 'blocker',
    label: 'Blocker',
    icon: Shield,
    to: 'blocker',
    match: ['blocker'],
    goto: 'g b',
  },
  settings: {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    to: 'settings',
    match: ['settings'],
    goto: 'g s',
  },
}

/** Main group of the sidebar (BRIEF §4), above the divider. */
export const PRIMARY_NAV: readonly NavItem[] = [
  NAV.today!,
  NAV.focus!,
  NAV.tasks!,
  NAV.goals!,
  NAV.world!,
  NAV.progress!,
  NAV.rewards!,
]

/** Below the divider. */
export const SECONDARY_NAV: readonly NavItem[] = [NAV.blocker!, NAV.settings!]

export interface TaskSubItem {
  list: 'inbox' | 'upcoming' | 'all' | 'completed'
  label: string
  icon: LucideIcon
}

export const TASK_SUBNAV: readonly TaskSubItem[] = [
  { list: 'inbox', label: 'Inbox', icon: Inbox },
  { list: 'upcoming', label: 'Upcoming', icon: CalendarDays },
  { list: 'all', label: 'All', icon: List },
  { list: 'completed', label: 'Completed', icon: CircleCheckBig },
]

/** Bottom tab bar under 640px (BRIEF §3.8); "More" opens a sheet with MORE_NAV. */
export const TAB_NAV: readonly NavItem[] = [NAV.today!, NAV.focus!, NAV.goals!, NAV.progress!]
export const MORE_NAV: readonly NavItem[] = [
  NAV.tasks!,
  NAV.world!,
  NAV.rewards!,
  NAV.blocker!,
  NAV.settings!,
]
export const MoreIcon = Ellipsis

export function isNavActive(item: NavItem, route: RouteName): boolean {
  return item.match.includes(route)
}
