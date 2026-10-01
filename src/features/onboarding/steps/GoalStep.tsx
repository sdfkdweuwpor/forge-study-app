import { Clock, GraduationCap, Target } from 'lucide-react'
import type { ReactNode } from 'react'
import type { GoalChoice } from '@/logic/onboarding'
import goalStyles from './GoalStep.module.css'
import styles from './steps.module.css'

export interface GoalStepProps {
  choice: GoalChoice
  onChoice: (choice: GoalChoice) => void
}

interface Option {
  value: GoalChoice
  icon: ReactNode
  title: string
  description: string
}

const OPTIONS: readonly Option[] = [
  {
    value: 'wgu',
    icon: <GraduationCap />,
    title: 'Plan a WGU term',
    description:
      'Start from the WGU term template: seven courses such as C182, C779 and D278, spread into daily study blocks.',
  },
  {
    value: 'other',
    icon: <Target />,
    title: 'Plan another goal',
    description:
      'A certification, a semester course or a project. Paste a syllabus, or start from a blank outline.',
  },
  {
    value: 'none',
    icon: <Clock />,
    title: 'Not now',
    description: 'Skip it. Goals are always one click away on the Goals page.',
  },
]

/**
 * Step 3: an optional first goal. Real radio inputs, so the arrow keys move between the choices and
 * screen readers hear "1 of 3". Nothing is scheduled here: the planner opens after setup and shows
 * everything for review before it creates anything.
 */
export function GoalStep({ choice, onChoice }: GoalStepProps) {
  return (
    <div className={styles.step}>
      <fieldset className={goalStyles.group}>
        <legend className="sr-only">First goal</legend>
        {OPTIONS.map((option) => (
          <label key={option.value} className={goalStyles.option}>
            <input
              type="radio"
              className={goalStyles.input}
              name="first-goal"
              value={option.value}
              checked={choice === option.value}
              onChange={() => onChoice(option.value)}
            />
            <span className={goalStyles.icon} aria-hidden="true">
              {option.icon}
            </span>
            <span className={goalStyles.text}>
              <span className={goalStyles.title}>{option.title}</span>
              <span className={goalStyles.description}>{option.description}</span>
            </span>
            <span className={goalStyles.mark} aria-hidden="true" />
          </label>
        ))}
      </fieldset>
      <p className={styles.hint}>
        The planner shows you everything to review before anything is scheduled.
      </p>
    </div>
  )
}
