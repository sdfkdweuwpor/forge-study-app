import { ChevronRight } from 'lucide-react'
import { useMemo, useSyncExternalStore } from 'react'
import { Link, useRoute } from '@/app/router'
import { PREF_KEYS, readPref, subscribePrefs, writePref } from '@/lib/localPrefs'
import { courseLabel } from '@/logic/goalDisplay'
import { DEFAULT_ICON } from '@/logic/goalDraft'
import { useGoalTree } from './queries'
import styles from './GoalsNav.module.css'

/** Which goals the person expanded or collapsed by hand, by id. Anything not listed follows the page. */
function parseOpen(raw: string | null): Record<string, boolean> {
  if (raw === null) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
      ),
    )
  } catch {
    return {}
  }
}

/**
 * The goals tree in the sidebar (slot `sidebar.nav.goals`): each goal with its courses under it. The goal
 * you are on is open by default; the chevron overrides that and is remembered on this device. The current
 * page carries `aria-current="page"`. Renders `<li>`s, as the sidebar's list expects.
 */
export function GoalsNav() {
  const tree = useGoalTree()
  const route = useRoute()
  const raw = useSyncExternalStore(
    subscribePrefs,
    () => readPref(PREF_KEYS.goalsNavOpen),
    () => null,
  )
  const explicit = useMemo(() => parseOpen(raw), [raw])

  if (tree === undefined || tree.length === 0) return null

  const activeGoal = route.name === 'goal' || route.name === 'course' ? route.params.goalId : null
  const activeCourse = route.name === 'course' ? route.params.courseId : null

  return (
    <>
      {tree.map(({ goal, courses }) => {
        const open = explicit[goal.id] ?? goal.id === activeGoal
        const goalCurrent = route.name === 'goal' && route.params.goalId === goal.id
        const listId = `goals-nav-${goal.id}`
        return (
          <li key={goal.id} className={styles.group}>
            <div className={styles.row} data-active={goalCurrent || undefined}>
              {courses.length > 0 ? (
                <button
                  type="button"
                  className={styles.toggle}
                  aria-expanded={open}
                  aria-controls={listId}
                  aria-label={`${open ? 'Collapse' : 'Expand'} ${goal.title}`}
                  onClick={() =>
                    writePref(
                      PREF_KEYS.goalsNavOpen,
                      JSON.stringify({ ...explicit, [goal.id]: !open }),
                    )
                  }
                >
                  <ChevronRight size={14} aria-hidden="true" data-open={open || undefined} />
                </button>
              ) : (
                <span className={styles.toggleSpace} aria-hidden="true" />
              )}
              <Link
                to="goal"
                params={{ goalId: goal.id }}
                className={styles.link}
                aria-current={goalCurrent ? 'page' : undefined}
              >
                <span className={styles.icon} aria-hidden="true">
                  {goal.icon || DEFAULT_ICON}
                </span>
                <span className={styles.label}>{goal.title}</span>
              </Link>
            </div>
            {open && courses.length > 0 ? (
              <ul id={listId} className={styles.courses}>
                {courses.map((c) => {
                  const current = activeCourse === c.id
                  return (
                    <li key={c.id}>
                      <Link
                        to="course"
                        params={{ goalId: goal.id, courseId: c.id }}
                        className={styles.courseLink}
                        data-active={current || undefined}
                        data-status={c.status}
                        aria-current={current ? 'page' : undefined}
                      >
                        <span className={styles.label}>{courseLabel(c)}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </li>
        )
      })}
    </>
  )
}
