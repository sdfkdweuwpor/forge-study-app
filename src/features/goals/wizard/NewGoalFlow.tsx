import { Smile } from 'lucide-react'
import { useEffect, useReducer, useRef, useState } from 'react'
import { useToday } from '@/app/hooks/useToday'
import { recordError } from '@/app/reportError'
import { navigate } from '@/app/router'
import { useSettings } from '@/db/hooks/useSettings'
import { createGoalWithCourses } from '@/db/repos/goals'
import { newId } from '@/lib/ids'
import { PREF_KEYS, readPref, removePref, writePref } from '@/lib/localPrefs'
import { draftToRows, firstInvalidStep, validateStep, type WizardStep } from '@/logic/goalDraft'
import { WGU_TEMPLATE_COURSES, wguTemplate } from '@/logic/goalTemplates'
import {
  initialWizard,
  isPristine,
  restoreWizard,
  serializeWizard,
  wizardReducer,
} from '@/logic/goalWizard'
import { Button } from '@/ui/Button'
import { CoverPicker, EmojiGrid } from '@/ui/PageHeader'
import { DatePicker } from '@/ui/DatePicker'
import { Input } from '@/ui/Input'
import { Kbd } from '@/ui/Kbd'
import { Modal } from '@/ui/Modal'
import { Popover } from '@/ui/Popover'
import { useToast } from '@/ui/Toast'
import { AvailabilityEditor } from './AvailabilityEditor'
import { CoursesStep } from './CoursesStep'
import { WizardPreview } from './WizardPreview'
import styles from './wizard.module.css'

const STEPS = ['Basics', 'Courses', 'Availability', 'Preview'] as const
const TEMPLATE_HOURS = WGU_TEMPLATE_COURSES.reduce((sum, c) => sum + c.hours, 0)

export interface NewGoalFlowProps {
  open: boolean
  onClose: () => void
}

/**
 * The new-goal flow: a four-step modal (basics, courses, availability, preview) that saves the goal
 * with its courses and units in one transaction, builds the first plan, and opens the goal page.
 * A half-finished draft survives a refresh. This is the piece the goal breakdown planner replaces:
 * `openNewGoalFlow()` in `../newGoal.ts` is the only way in.
 */
export function NewGoalFlow({ open, onClose }: NewGoalFlowProps) {
  const today = useToday()
  const toast = useToast()
  const settings = useSettings()
  const [state, dispatch] = useReducer(
    wizardReducer,
    today,
    (t) => restoreWizard(readPref(PREF_KEYS.goalWizardDraft)) ?? initialWizard(t),
  )
  const { draft, step, reached, attempted } = state
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const body = useRef<HTMLDivElement | null>(null)

  // Keep a half-finished draft across a refresh; a fresh one leaves nothing behind.
  useEffect(() => {
    if (isPristine(draft, today) && step === 0) removePref(PREF_KEYS.goalWizardDraft)
    else writePref(PREF_KEYS.goalWizardDraft, serializeWizard(state))
  }, [state, draft, step, today])

  // Each step starts at the top of the dialog body.
  useEffect(() => {
    body.current?.scrollTo({ top: 0 })
  }, [step])

  const errors = attempted ? validateStep(draft, step, today) : {}
  const last = step === 3

  function next() {
    const problems = validateStep(draft, step, today)
    if (Object.keys(problems).length > 0) {
      dispatch({ type: 'attempt' })
      return
    }
    if (!last) dispatch({ type: 'go', step: (step + 1) as WizardStep })
    else void create()
  }

  async function create() {
    const bad = firstInvalidStep(draft, today)
    if (bad !== null) {
      dispatch({ type: 'go', step: bad })
      dispatch({ type: 'attempt' })
      return
    }
    setSaving(true)
    setFailed(false)
    try {
      const now = Date.now()
      const rows = draftToRows(draft, { today, now, newId })
      const created = await createGoalWithCourses(rows, { now })
      removePref(PREF_KEYS.goalWizardDraft)
      dispatch({ type: 'replace', draft: initialWizard(today).draft })
      if (created.planError !== null) {
        recordError(created.planError, 'firstPlan')
        toast.error('Goal created, but the schedule could not be built', {
          description: 'Open the goal and rebalance it to try again.',
        })
      } else {
        toast.success(`Created “${created.goal.title}”`, {
          description: `${created.summary?.inserted ?? 0} study blocks scheduled.`,
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

  function loadTemplate() {
    const previous = state
    dispatch({ type: 'replace', draft: wguTemplate(today, newId), step: 1 })
    toast.show({
      title: 'Loaded the WGU B.S. Computer Science template',
      description: 'Seven courses with hours, CUs and units. Change anything you like.',
      undo: () => dispatch({ type: 'replace', draft: previous.draft, step: previous.step }),
    })
  }

  // Ctrl or Cmd + Enter moves on from anywhere in the dialog (the shortcut sheet lists it).
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.defaultPrevented) {
        e.preventDefault()
        if (!saving) next()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const cover =
    draft.coverPreset === null ? null : { kind: 'gradient' as const, preset: draft.coverPreset }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New goal"
      size="lg"
      description={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`}
      footer={
        <div className={styles.footer}>
          <div className={styles.footerStart}>
            {!isPristine(draft, today) ? (
              <Button
                variant="ghost"
                onClick={() => dispatch({ type: 'replace', draft: initialWizard(today).draft })}
              >
                Start over
              </Button>
            ) : null}
            <span className={styles.keyHint}>
              <Kbd keys="mod+enter" size="sm" /> {last ? 'create' : 'next'}
            </span>
          </div>
          {failed ? (
            <p className={styles.footerError} role="alert">
              Couldn’t create the goal. Nothing was saved.
            </p>
          ) : null}
          {step > 0 ? (
            <Button onClick={() => dispatch({ type: 'go', step: (step - 1) as WizardStep })}>
              Back
            </Button>
          ) : null}
          <Button variant="primary" loading={saving} onClick={next}>
            {last ? 'Create goal' : 'Next'}
          </Button>
        </div>
      }
    >
      <div ref={body} className={styles.body}>
        <nav aria-label="Steps" className={styles.steps}>
          <ol>
            {STEPS.map((name, i) => (
              <li
                key={name}
                aria-current={i === step ? 'step' : undefined}
                data-done={i < step || undefined}
              >
                <button
                  type="button"
                  disabled={i > reached}
                  onClick={() => dispatch({ type: 'go', step: i as WizardStep })}
                >
                  <span className={styles.stepNumber}>{i + 1}</span>
                  <span className={styles.stepName}>{name}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        {step === 0 ? (
          <div className={styles.step}>
            <div className={styles.titleRow}>
              <Popover
                label="Choose icon"
                align="start"
                trigger={(p) => (
                  <button
                    {...p}
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Icon: ${draft.icon}. Change`}
                  >
                    <span aria-hidden="true">{draft.icon || <Smile />}</span>
                  </button>
                )}
              >
                {({ close }) => (
                  <EmojiGrid
                    current={draft.icon}
                    onPick={(icon) => {
                      dispatch({ type: 'patch', patch: { icon } })
                      close()
                    }}
                  />
                )}
              </Popover>
              <Input
                data-autofocus=""
                label="Goal name"
                placeholder="B.S. Computer Science"
                value={draft.title}
                maxLength={120}
                error={errors.title}
                className={styles.titleInput}
                onChange={(e) => dispatch({ type: 'patch', patch: { title: e.target.value } })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault()
                    next()
                  }
                }}
              />
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Target end date</span>
              <DatePicker
                label="Target end date"
                value={draft.targetDate}
                today={today}
                min={today}
                error={errors.targetDate}
                onChange={(targetDate) => dispatch({ type: 'patch', patch: { targetDate } })}
              />
              <p className={styles.hint}>
                Optional. Without one, Forge just projects a finish date.
              </p>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Cover</span>
              <CoverPicker
                cover={cover}
                onPick={(c) =>
                  c.kind === 'gradient' &&
                  dispatch({ type: 'patch', patch: { coverPreset: c.preset } })
                }
                onRemove={
                  cover
                    ? () => dispatch({ type: 'patch', patch: { coverPreset: null } })
                    : undefined
                }
              />
            </div>
            <p className={styles.hint}>
              Starting a WGU degree?{' '}
              <button type="button" className={styles.link} onClick={loadTemplate}>
                Load the B.S. Computer Science template
              </button>{' '}
              ({TEMPLATE_HOURS} h across {WGU_TEMPLATE_COURSES.length} courses).
            </p>
          </div>
        ) : null}

        {step === 1 ? (
          <CoursesStep
            draft={draft}
            dispatch={dispatch}
            errors={errors}
            onLoadTemplate={loadTemplate}
          />
        ) : null}

        {step === 2 ? (
          <AvailabilityEditor draft={draft} dispatch={dispatch} errors={errors} today={today} />
        ) : null}

        {step === 3 ? (
          <WizardPreview
            draft={draft}
            today={today}
            globalDaysOff={settings?.scheduling.globalDaysOff ?? []}
          />
        ) : null}
      </div>
    </Modal>
  )
}
