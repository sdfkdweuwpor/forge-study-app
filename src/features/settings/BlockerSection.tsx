import { ArrowRight } from 'lucide-react'
import { useId } from 'react'
import { Link } from '@/app/router'
import { BLOCKER } from './sections'
import styles from './settings.module.css'

/**
 * Settings section (slot `settings.sections`): the blocker has a page of its own, so this is only the
 * way there. Sites, schedule, allowlist, the extension and unlocking all live on that page.
 */
export function BlockerSection() {
  const headingId = useId()
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {BLOCKER.title}
      </h2>
      <div className={styles.row}>
        <div className={styles.text}>
          <span className={styles.label}>Blocked sites and schedule</span>
          <p className={styles.help}>
            Choose the sites to keep out of the way, when they’re blocked, and connect the Chrome
            extension.
          </p>
        </div>
        <div className={styles.control}>
          <Link to="blocker" className={styles.link}>
            Open Blocker
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  )
}
