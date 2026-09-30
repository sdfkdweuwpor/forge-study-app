import type { Ref } from 'react'
import { DAILY_GOAL_MAX, DAILY_GOAL_MIN, NAME_MAX, focusHint } from '@/logic/onboarding'
import { Input } from '@/ui/Input'
import { Stepper } from './Stepper'
import styles from './steps.module.css'

export interface NameStepProps {
  name: string
  onName: (name: string) => void
  goal: number
  onGoal: (goal: number) => void
  /** Minutes in one pomodoro, for the "≈ 2.5 h of focus" hint. */
  pomodoroMin: number
  nameRef: Ref<HTMLInputElement>
}

/** Step 1: what to call the person, and how many pomodoros make a good day. */
export function NameStep({ name, onName, goal, onGoal, pomodoroMin, nameRef }: NameStepProps) {
  return (
    <div className={styles.step}>
      <Input
        ref={nameRef}
        label="Your name"
        placeholder="Maya"
        value={name}
        maxLength={NAME_MAX}
        autoComplete="given-name"
        hint="Optional. It only shows up in the greeting on Today."
        onChange={(e) => onName(e.target.value)}
      />

      <section className={styles.section} aria-labelledby="onboarding-goal">
        <h2 id="onboarding-goal" className={styles.sectionTitle}>
          Daily goal
        </h2>
        <p className={styles.hint}>
          How many pomodoros make a good day? Hitting the goal keeps your streak alive and earns
          bonus XP.
        </p>
        <Stepper
          label="Pomodoros per day"
          unit="pomodoro"
          value={goal}
          min={DAILY_GOAL_MIN}
          max={DAILY_GOAL_MAX}
          onChange={onGoal}
        />
        <p className={styles.hint} aria-live="polite" data-testid="focus-hint">
          {focusHint(goal, pomodoroMin)}
        </p>
      </section>
    </div>
  )
}
