/**
 * `/welcome`: the first-launch flow (BRIEF §5.10). Four skippable steps (name and daily goal, distracting
 * sites, an optional first goal, the Chrome extension) on a calm page of its own, without the sidebar.
 * Each step saves when you continue, so leaving early keeps what was done. Finishing adds three starter
 * tasks (first run only), records `settings.onboardedAt` and lands on Today, or on the planner when a
 * goal was chosen. "Skip setup" is always in the corner.
 */
import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useToday } from '@/app/hooks/useToday'
import { recordError } from '@/app/reportError'
import { navigate } from '@/app/router'
import { useShortcutHandler } from '@/app/shortcuts'
import { useSettings } from '@/db/hooks/useSettings'
import { DEFAULT_BLOCKED_DOMAINS } from '@/db/defaults'
import type { Settings } from '@/db/types'
import {
  STEP_COUNT,
  STEP_NAMES,
  addChip,
  checkNewSite,
  choiceTemplate,
  clampDailyGoal,
  cleanName,
  initialChips,
  nextStep,
  previousStep,
  toggleChip,
  type GoalChoice,
  type OnboardingStep,
  type SiteChip,
} from '@/logic/onboarding'
import { Button } from '@/ui/Button'
import { Kbd } from '@/ui/Kbd'
import { ProgressBar } from '@/ui/ProgressBar'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/Toast'
import {
  finishOnboarding,
  loadBlocklist,
  markOnboarded,
  saveBlocklist,
  saveProfile,
} from './actions'
import { ExtensionStep } from './steps/ExtensionStep'
import { GoalStep } from './steps/GoalStep'
import { NameStep } from './steps/NameStep'
import { SitesStep, type SitesStatus } from './steps/SitesStep'
import styles from './WelcomePage.module.css'

const HEADINGS: readonly { title: string; lead: string }[] = [
  {
    title: 'What should we call you?',
    lead: 'Two quick things to make Forge yours. Everything here can be changed later in Settings.',
  },
  {
    title: 'Which sites pull you away?',
    lead: 'The Chrome extension keeps these out of reach while you focus. Pick the ones that get you.',
  },
  {
    title: 'Got a goal in mind?',
    lead: 'Forge turns a goal into daily study blocks. You can start one now, or whenever you are ready.',
  },
  {
    title: 'Block distractions for real',
    lead: 'A website can’t block other websites, so a small Chrome extension does it. This takes about a minute.',
  },
]

/** Focus moves to the first field on a device with a mouse; a phone keeps its keyboard closed. */
const hasFinePointer = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches

function FlowSkeleton() {
  return (
    <div className={styles.column} aria-busy="true">
      <div role="status" aria-label="Loading setup" className={styles.skeleton}>
        <Skeleton width={120} />
        <Skeleton width="70%" height={36} variant="block" />
        <Skeleton lines={2} />
        <Skeleton variant="block" height={36} />
      </div>
    </div>
  )
}

interface FlowProps {
  settings: Settings
  leaving: boolean
}

function Flow({ settings, leaving }: FlowProps) {
  const toast = useToast()
  const today = useToday()
  // Read once: onboarding sets `onboardedAt` at the very end, and the flow must not change its mind then.
  const [firstRun] = useState(settings.onboardedAt === null)

  const [step, setStep] = useState<OnboardingStep>(0)
  const [name, setName] = useState(settings.profile.name)
  const [goal, setGoal] = useState(clampDailyGoal(settings.dailyGoalPomodoros))
  const [choice, setChoice] = useState<GoalChoice>('none')
  const [chips, setChips] = useState<SiteChip[]>([])
  const [sites, setSites] = useState<SitesStatus>('loading')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const heading = useRef<HTMLHeadingElement>(null)
  const nameField = useRef<HTMLInputElement>(null)

  // The sites are read up front so that step 2 opens ready.
  useEffect(() => {
    let alive = true
    loadBlocklist()
      .then((rows) => {
        if (!alive) return
        setChips(initialChips(rows, DEFAULT_BLOCKED_DOMAINS))
        setSites('ready')
      })
      .catch((e: unknown) => {
        if (!alive) return
        recordError(e, 'onboarding.blocklist')
        setSites('error')
      })
    return () => {
      alive = false
    }
  }, [attempt])

  // Each step starts where the eye and the keyboard should: the name field, or the new heading.
  useEffect(() => {
    if (step === 0 && hasFinePointer()) nameField.current?.focus()
    else heading.current?.focus()
  }, [step])

  const retrySites = () => {
    setSites('loading')
    setAttempt((n) => n + 1)
  }

  const addSite = (raw: string): string | null => {
    const result = checkNewSite(raw, chips)
    if (result.kind === 'error') return result.message
    setChips((current) => addChip(current, result))
    return null
  }

  async function finish() {
    setBusy(true)
    setError(null)
    try {
      const { starterTasks } = await finishOnboarding({ firstRun, today, now: Date.now() })
      const template = choiceTemplate(choice)
      const who = cleanName(name)
      const facts: string[] = []
      if (starterTasks > 0) facts.push('Three starter tasks are waiting on Today.')
      else facts.push(firstRun ? 'Your setup is saved.' : 'Your changes are saved.')
      if (choice === 'wgu') facts.push('Now let’s plan your WGU term.')
      else if (choice === 'other') facts.push('Now let’s plan your first goal.')
      navigate(choice === 'none' ? 'today' : 'goalNew', undefined, {
        replace: true,
        query: template === null ? undefined : { template },
      })
      toast.success(who === '' ? 'You’re all set' : `You’re all set, ${who}`, {
        description: facts.join(' '),
      })
    } catch (e) {
      recordError(e, 'onboarding.finish')
      setError('Couldn’t finish setup. Your data is safe on this device. Try again.')
      setBusy(false)
    }
  }

  /** Moves on; with `save`, keeps what this step collected first. A skipped step saves nothing. */
  async function advance(save: boolean) {
    if (busy || leaving) return
    if (step === STEP_COUNT - 1) {
      await finish()
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (save && step === 0) await saveProfile({ name, dailyGoal: goal })
      if (save && step === 1 && sites === 'ready') await saveBlocklist(chips)
      const next = nextStep(step)
      if (next !== null) setStep(next)
    } catch (e) {
      recordError(e, `onboarding.step${step + 1}`)
      setError(
        'Couldn’t save that. Your data is safe on this device. Try again, or skip this step.',
      )
    } finally {
      setBusy(false)
    }
  }

  function back() {
    if (busy || leaving) return
    const previous = previousStep(step)
    if (previous !== null) {
      setError(null)
      setStep(previous)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void advance(true)
  }

  useShortcutHandler('onboarding.next', () => void advance(true))
  useShortcutHandler('onboarding.skipStep', () => void advance(false))
  useShortcutHandler('onboarding.back', back)

  const last = step === STEP_COUNT - 1
  const { title, lead } = HEADINGS[step] ?? HEADINGS[0]!

  return (
    <div className={styles.column}>
      <div className={styles.progress}>
        <p className={styles.stepCount} aria-live="polite">
          Step {step + 1} of {STEP_COUNT} · {STEP_NAMES[step]}
        </p>
        <ProgressBar
          size="sm"
          value={step + 1}
          max={STEP_COUNT}
          label="Setup progress"
          valueText={`Step ${step + 1} of ${STEP_COUNT}: ${STEP_NAMES[step]}`}
        />
      </div>

      <form className={styles.step} key={step} onSubmit={onSubmit} noValidate>
        <header className={styles.header}>
          <h1 ref={heading} tabIndex={-1} className={styles.title}>
            {title}
          </h1>
          <p className={styles.lead}>{lead}</p>
        </header>

        {step === 0 ? (
          <NameStep
            name={name}
            onName={setName}
            goal={goal}
            onGoal={setGoal}
            pomodoroMin={settings.timer.pomodoroMin}
            nameRef={nameField}
          />
        ) : null}
        {step === 1 ? (
          <SitesStep
            status={sites}
            chips={chips}
            onToggle={(domain) => setChips((current) => toggleChip(current, domain))}
            onAdd={addSite}
            onRetry={retrySites}
          />
        ) : null}
        {step === 2 ? <GoalStep choice={choice} onChoice={setChoice} /> : null}
        {step === 3 ? <ExtensionStep /> : null}

        {error !== null ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <footer className={styles.footer}>
          <div className={styles.footerStart}>
            {step > 0 ? (
              <Button
                variant="ghost"
                iconLeft={<ArrowLeft />}
                disabled={busy || leaving}
                onClick={back}
              >
                Back
              </Button>
            ) : null}
          </div>
          <div className={styles.footerEnd}>
            <span className={styles.keyHint}>
              <Kbd keys="alt+right" size="sm" /> continue
            </span>
            <Button variant="ghost" disabled={busy || leaving} onClick={() => void advance(false)}>
              {last ? 'I’ll do it later' : 'Skip this step'}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={leaving || (step === 1 && sites === 'loading')}
            >
              {last ? 'Finish setup' : 'Continue'}
            </Button>
          </div>
        </footer>
      </form>
    </div>
  )
}

export default function WelcomePage() {
  const toast = useToast()
  const settings = useSettings()
  const [leaving, setLeaving] = useState(false)

  /** Marks onboarding done without adding anything, and goes to Today. */
  async function skipSetup() {
    if (leaving) return
    setLeaving(true)
    try {
      await markOnboarded(Date.now())
      navigate('today', undefined, { replace: true })
      toast.show({
        title: 'Setup skipped',
        description: 'Run “Replay onboarding” from the command palette whenever you like.',
      })
    } catch (e) {
      recordError(e, 'onboarding.skip')
      toast.error('Couldn’t skip setup', { description: 'Your data is safe. Try again.' })
      setLeaving(false)
    }
  }

  useShortcutHandler('onboarding.skipSetup', () => void skipSetup())

  return (
    <div className={styles.root}>
      <div className={styles.top}>
        <div className={styles.brand}>
          <img
            className={styles.mark}
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            alt=""
            width={22}
            height={22}
          />
          <span>Forge</span>
        </div>
        <Button variant="ghost" loading={leaving} onClick={() => void skipSetup()}>
          Skip setup
        </Button>
      </div>
      {settings === undefined ? <FlowSkeleton /> : <Flow settings={settings} leaving={leaving} />}
    </div>
  )
}
