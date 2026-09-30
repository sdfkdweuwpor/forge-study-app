/**
 * `/goals/new`: the Goal Breakdown Planner. Seven calm steps (start, when, availability, effort, review,
 * preview, confirm) over one draft that survives a refresh. Nothing is scheduled until Confirm, and even
 * AI output (Claude's JSON) only ever lands on the review steps. Confirm creates the goal, its courses,
 * units, planned assessments and planning settings in one transaction and builds the first plan.
 */
import { X } from 'lucide-react'
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useToday } from '@/app/hooks/useToday'
import { recordError } from '@/app/reportError'
import { href, navigate, navigateToUrl, usePageTitle } from '@/app/router'
import { useShortcutHandler } from '@/app/shortcuts'
import { createGoalWithCourses, trashGoal } from '@/db/repos/goals'
import { newId } from '@/lib/ids'
import { PREF_KEYS, readPref, removePref, writePref } from '@/lib/localPrefs'
import {
  emptyPlannerDraft,
  firstInvalidStep,
  initialPlannerState,
  isPristine,
  LAST_STEP,
  plannerReducer,
  plannerRows,
  readSourceText,
  readTypedGoal,
  STEP_NAMES,
  validatePlannerStep,
  type PlannerState,
  type PlannerStep,
} from '@/logic/plannerDraft'
import { restorePlanner, serializePlanner } from '@/logic/plannerPersist'
import { Breadcrumbs, type BreadcrumbLinkProps } from '@/ui/Breadcrumbs'
import { Button } from '@/ui/Button'
import { IconButton } from '@/ui/IconButton'
import { Kbd } from '@/ui/Kbd'
import { ProgressBar } from '@/ui/ProgressBar'
import { useToast } from '@/ui/Toast'
import { AvailabilityStep } from './steps/AvailabilityStep'
import { ConfirmStep } from './steps/ConfirmStep'
import { EffortStep } from './steps/EffortStep'
import { PreviewStep } from './steps/PreviewStep'
import { ReviewStep } from './steps/ReviewStep'
import { StartStep, type InputTab } from './steps/StartStep'
import { WhenStep } from './steps/WhenStep'
import styles from './PlannerPage.module.css'

const STEP_HEADINGS: readonly string[] = [
  'What are you planning?',
  'When',
  'Availability',
  'Effort',
  'Review the plan',
  'Does it fit?',
  'Confirm',
]

/** Breadcrumb links that navigate inside the app (modified clicks still open a new tab). */
function crumbLink({ item, className, children }: BreadcrumbLinkProps): ReactNode {
  return (
    <a
      href={item.href}
      className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        if (item.href) {
          e.preventDefault()
          navigateToUrl(item.href)
        }
      }}
    >
      {children}
    </a>
  )
}

function PlannerScreen() {
  const today = useToday()
  const toast = useToast()
  const [state, dispatch] = useReducer(
    plannerReducer,
    today,
    (t): PlannerState => restorePlanner(readPref(PREF_KEYS.plannerDraft), t) ?? initialPlannerState(t),
  )
  const { draft, step, reached, attempted } = state
  const [tab, setTab] = useState<InputTab>(() =>
    draft.source === 'pdf' ? 'pdf' : draft.source === 'typed' ? 'goal' : 'paste',
  )
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const done = useRef(false)
  const top = useRef<HTMLDivElement | null>(null)
  usePageTitle('New goal')

  // Keep a half-finished draft across a refresh; a fresh one leaves nothing behind.
  useEffect(() => {
    if (done.current) return
    if (isPristine(draft, today) && step === 0) removePref(PREF_KEYS.plannerDraft)
    else writePref(PREF_KEYS.plannerDraft, serializePlanner(state))
  }, [state, draft, step, today])

  // Each step starts at the top.
  useEffect(() => {
    top.current?.scrollIntoView({ block: 'start' })
  }, [step])

  const errors = attempted ? validatePlannerStep(draft, step, today) : {}
  const last = step === LAST_STEP

  const go = (to: PlannerStep) => dispatch({ type: 'go', step: to })

  async function next() {
    if (saving) return
    let current = draft
    // On the first step, text that was typed but not read yet is read now.
    if (step === 0 && current.courses.length === 0) {
      if (tab === 'goal' && current.title.trim() !== '') {
        current = readTypedGoal(current, { newKey: newId, today })
      } else if ((tab === 'paste' || tab === 'pdf') && current.sourceText.trim() !== '') {
        current = readSourceText(current, current.sourceText, {
          source: tab === 'pdf' ? 'pdf' : 'paste',
          newKey: newId,
          today,
        })
      }
      if (current !== draft) dispatch({ type: 'replaceDraft', draft: current })
    } else if (
      step === 0 &&
      (current.source === 'paste' || current.source === 'pdf') &&
      current.sourceText !== current.readText &&
      current.sourceText.trim() !== ''
    ) {
      current = readSourceText(current, current.sourceText, {
        source: current.source,
        newKey: newId,
        today,
      })
      dispatch({ type: 'replaceDraft', draft: current })
    }
    const problems = validatePlannerStep(current, step, today)
    if (Object.keys(problems).length > 0) {
      dispatch({ type: 'attempt' })
      return
    }
    if (!last) go((step + 1) as PlannerStep)
    else await create(current)
  }

  function back() {
    if (step > 0 && !saving) go((step - 1) as PlannerStep)
  }

  async function create(d = draft) {
    const bad = firstInvalidStep(d, today)
    if (bad !== null) {
      go(bad)
      dispatch({ type: 'attempt' })
      return
    }
    setSaving(true)
    setFailed(false)
    try {
      const now = Date.now()
      const rows = plannerRows(d, { today, now, newId })
      const created = await createGoalWithCourses(rows, { now })
      done.current = true
      const saved = serializePlanner(state)
      removePref(PREF_KEYS.plannerDraft)
      if (created.planError !== null) {
        recordError(created.planError, 'firstPlan')
        toast.error('Goal created, but the schedule could not be built', {
          description: 'Open the goal and re-plan it to try again.',
        })
      } else {
        toast.show({
          title: `Created “${created.goal.title}”`,
          description: `${created.summary?.inserted ?? 0} study blocks scheduled. Undo moves it to the trash.`,
          undo: async () => {
            await trashGoal(created.goal.id)
            writePref(PREF_KEYS.plannerDraft, saved)
            navigate('goalNew')
          },
        })
      }
      navigate('goal', { goalId: created.goal.id })
    } catch (error) {
      recordError(error, 'createGoal')
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  function startOver() {
    const previous = state
    dispatch({ type: 'replaceDraft', draft: emptyPlannerDraft(today), step: 0 })
    setTab('paste')
    toast.show({
      title: 'Started over',
      undo: () => dispatch({ type: 'replaceDraft', draft: previous.draft, step: previous.step }),
    })
  }

  useShortcutHandler('planner.next', () => void next())
  useShortcutHandler('planner.back', () => back())

  const stepProps = { draft, dispatch, errors, today }

  return (
    <div className={styles.root}>
      <div ref={top} className={styles.top}>
        <Breadcrumbs
          renderLink={crumbLink}
          items={[{ label: 'Goals', href: href('goals') }, { label: 'New goal' }]}
        />
        <div className={styles.topActions}>
          {!isPristine(draft, today) ? (
            <Button variant="ghost" size="sm" onClick={startOver}>
              Start over
            </Button>
          ) : null}
          <IconButton
            size="md"
            label="Close and keep my draft"
            icon={<X />}
            onClick={() => navigate('goals')}
          />
        </div>
      </div>

      <header className={styles.header}>
        <p className={styles.stepCount} aria-live="polite">
          Step {step + 1} of {STEP_NAMES.length}
        </p>
        <h1 className={styles.heading}>{STEP_HEADINGS[step]}</h1>
        <ProgressBar
          size="sm"
          value={Math.round(((step + 1) / STEP_NAMES.length) * 100)}
          label="Planner progress"
          valueText={`Step ${step + 1} of ${STEP_NAMES.length}: ${STEP_NAMES[step]}`}
        />
        <nav aria-label="Steps" className={styles.steps}>
          <ol>
            {STEP_NAMES.map((name, i) => (
              <li
                key={name}
                aria-current={i === step ? 'step' : undefined}
                data-done={i < step || undefined}
              >
                <button type="button" disabled={i > reached} onClick={() => go(i as PlannerStep)}>
                  <span className={styles.stepNumber}>{i + 1}</span>
                  <span className={styles.stepName}>{name}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      <main className={styles.body} id="planner-step">
        {step === 0 ? (
          <StartStep {...stepProps} tab={tab} onTab={setTab} onGo={go} />
        ) : null}
        {step === 1 ? <WhenStep {...stepProps} /> : null}
        {step === 2 ? <AvailabilityStep {...stepProps} /> : null}
        {step === 3 ? <EffortStep draft={draft} dispatch={dispatch} errors={errors} /> : null}
        {step === 4 ? <ReviewStep {...stepProps} /> : null}
        {step === 5 ? <PreviewStep draft={draft} dispatch={dispatch} today={today} /> : null}
        {step === 6 ? <ConfirmStep {...stepProps} failed={failed} /> : null}
      </main>

      <footer className={styles.footer}>
        <span className={styles.keyHint}>
          <Kbd keys="alt+enter" size="sm" /> {last ? 'create' : 'continue'}
        </span>
        <div className={styles.footerActions}>
          {step > 0 ? (
            <Button onClick={back} disabled={saving}>
              Back
            </Button>
          ) : null}
          <Button variant="primary" loading={saving} onClick={() => void next()}>
            {last ? 'Create goal' : step === 5 ? 'Continue' : 'Continue'}
          </Button>
        </div>
      </footer>
    </div>
  )
}

/** The route page. */
export default function PlannerPage() {
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <div className={styles.root}>
          <h1 className={styles.heading}>Something went wrong</h1>
          <p className={styles.stepCount}>
            The planner hit a problem. Your draft is saved on this device.
          </p>
          <div>
            <Button variant="primary" onClick={reset}>
              Try again
            </Button>
          </div>
        </div>
      )}
    >
      <PlannerScreen />
    </ErrorBoundary>
  )
}
