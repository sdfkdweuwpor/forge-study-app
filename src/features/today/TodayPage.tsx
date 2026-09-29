import { format } from 'date-fns'
import { useSettings } from '@/db/hooks/useSettings'
import { Slot } from '@/app/registry'
import { useNow } from '@/app/hooks/useNow'
import styles from './TodayPage.module.css'

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** Phase 1 hello page: greeting and date, plus the Today slots so features can already plug in. */
export default function TodayPage() {
  const now = useNow('minute')
  const settings = useSettings()
  const name = settings?.profile.name.trim() ?? ''
  const date = new Date(now)

  return (
    <div className={styles.root}>
      <Slot id="today.header" />
      <header className={styles.header}>
        <h1 className={styles.title}>
          {greetingFor(date.getHours())}
          {name ? `, ${name}` : ''}
          <span className={styles.date}>{` — ${format(date, 'EEEE, MMM d')}`}</span>
        </h1>
      </header>
      <Slot id="today.now" />
      <Slot id="today.main" />
      <section className={styles.empty} aria-label="Today’s plan">
        <h2 className={styles.emptyTitle}>Nothing planned yet</h2>
        <p className={styles.emptyBody}>
          Add a goal such as your B.S. in Computer Science and Forge will schedule C182, C779 and
          the rest of your courses into daily study blocks. They will show up here.
        </p>
      </section>
      <Slot id="today.aside" />
    </div>
  )
}
