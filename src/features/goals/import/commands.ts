import { Sparkles } from 'lucide-react'
import type { CommandDef } from '@/app/registry'
import { setQuery } from '@/app/router'

export type ImportPlace =
  /** On a goal page: open its import panel by setting the flag in place. */
  | { kind: 'goalPage' }
  /** On a course page of a goal: go to the goal page with the flag. */
  | { kind: 'coursePage'; goalId: string }
  /** Anywhere else: the goals list, where the import-a-new-goal dialog opens. */
  | { kind: 'list' }

/** Where "Import plan from Claude" should open for the page at `pathname`. */
export function whereToImport(pathname: string): ImportPlace {
  const match = /^\/goals\/([^/]+)(\/courses\/[^/]+)?\/?$/.exec(pathname)
  const goalId = match?.[1]
  if (!goalId || goalId === 'new') return { kind: 'list' }
  return match[2] ? { kind: 'coursePage', goalId } : { kind: 'goalPage' }
}

/**
 * "Import plan from Claude" (PLAN §5.2). On a goal or course page it opens that goal's import panel;
 * anywhere else it opens the import-a-new-goal dialog on the goals list. Both listen for `?import=1`,
 * so the command needs nothing from the components.
 */
export const importCommands: CommandDef[] = [
  {
    id: 'command.goals.importPlan',
    title: 'Import plan from Claude',
    group: 'Goals',
    icon: Sparkles,
    keywords: ['claude', 'json', 'paste', 'outline', 'courses', 'prompt', 'ai', 'import'],
    shortcutId: 'goals.import',
    run: (c) => {
      const place = whereToImport(window.location.pathname)
      if (place.kind === 'goalPage') setQuery({ import: '1' })
      else if (place.kind === 'coursePage') {
        c.navigate('goal', { goalId: place.goalId }, { query: { import: '1' } })
      } else c.navigate('goals', undefined, { query: { import: '1' } })
    },
  },
]
