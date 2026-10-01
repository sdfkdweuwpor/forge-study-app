/** Named UI slots (PLAN §1.5). Ids and props are fixed in Phase 1; features contribute to them via their manifest. */

type NoProps = Record<never, never>

export interface SlotProps {
  /** `onNavigate` is set where the sidebar is a tablet drawer: it closes it (a link to the page you are on changes no path, so the drawer would stay). Desktop passes nothing. */
  'sidebar.footer': { onNavigate?: () => void }
  /** Compact status beside the "Open sidebar" button while the sidebar is collapsed (desktop) or a drawer (tablet). */
  'sidebar.rail': NoProps
  /** The foot of the phone's More sheet. `onNavigate` closes the sheet: a link to the page you are already on changes no path, so the sheet would never close by itself. */
  'more.footer': { onNavigate: () => void }
  'sidebar.timer': NoProps
  'sidebar.nav.tasks': NoProps
  'sidebar.nav.goals': NoProps
  'shell.rightPanel': NoProps
  'global.overlays': NoProps
  'today.header': NoProps
  'today.now': NoProps
  'today.main': NoProps
  'today.aside': NoProps
  'focus.aside': NoProps
  'focus.afterSession': { sessionId: string }
  'goal.header': { goalId: string }
  'goal.panels': { goalId: string }
  'course.panels': { goalId: string; courseId: string }
  'progress.sections': NoProps
  'rewards.tabs': NoProps
  'blocker.sections': NoProps
  'settings.sections': NoProps
}

export type SlotId = keyof SlotProps

export const SLOT_IDS = [
  'sidebar.footer',
  'sidebar.rail',
  'more.footer',
  'sidebar.timer',
  'sidebar.nav.tasks',
  'sidebar.nav.goals',
  'shell.rightPanel',
  'global.overlays',
  'today.header',
  'today.now',
  'today.main',
  'today.aside',
  'focus.aside',
  'focus.afterSession',
  'goal.header',
  'goal.panels',
  'course.panels',
  'progress.sections',
  'rewards.tabs',
  'blocker.sections',
  'settings.sections',
] as const satisfies readonly SlotId[]
