import { RecentBadges } from '@/features/gamification'
import styles from './sections.module.css'

/** The newest badges, from the gamification feature (it has its own loading, empty and error states). */
export function BadgesSection() {
  return (
    <section className={styles.section} aria-labelledby="progress-badges" data-section="badges">
      <h2 id="progress-badges" className={styles.heading}>
        Recent badges
      </h2>
      <RecentBadges limit={3} />
    </section>
  )
}
