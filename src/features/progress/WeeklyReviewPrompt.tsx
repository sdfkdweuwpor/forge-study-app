import { ArrowRight } from 'lucide-react'
import { useToday } from '@/app/hooks/useToday'
import { Link } from '@/app/router'
import { useSettings } from '@/db/hooks/useSettings'
import { isReviewDay, reviewWeekStart } from '@/logic/weeklyReview'
import { useStoredReview } from './WeeklyReviewData'
import styles from './WeeklyReviewPrompt.module.css'

/**
 * Slot `today.aside`: on the last day of the week (Sunday, or Saturday when weeks start on Sunday) a
 * quiet card says the week's review is ready and links to it, until that week's review is marked done.
 * It never nags: no count, no red, nothing on any other day, and nothing while it loads or if a read
 * fails (it is an invitation, not a screen, so it simply is not there).
 */
export function WeeklyReviewPrompt() {
  const today = useToday()
  const settings = useSettings()
  const weekStartsOn = settings?.weekStartsOn
  const stored = useStoredReview(
    weekStartsOn === undefined ? null : reviewWeekStart(today, weekStartsOn),
  )

  if (weekStartsOn === undefined || stored === undefined) return null
  if (!isReviewDay(today, weekStartsOn) || stored?.completedAt != null) return null

  return (
    <section
      className={styles.card}
      aria-labelledby="weekly-review-prompt"
      data-testid="weekly-review-prompt"
    >
      <h2 className={styles.heading} id="weekly-review-prompt">
        Weekly review
      </h2>
      <Link to="weeklyReview" className={styles.lead}>
        Your week in review is ready
        <ArrowRight aria-hidden="true" />
      </Link>
      <p className={styles.quiet}>
        Your wins, hours per goal and a look at next week. A couple of minutes.
      </p>
    </section>
  )
}
