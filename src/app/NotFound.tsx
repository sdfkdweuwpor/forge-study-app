import { Compass } from 'lucide-react'
import { Link, usePathname } from './router'
import styles from './Placeholder.module.css'

export function NotFound() {
  const pathname = usePathname()
  return (
    <section className={styles.root} aria-labelledby="notfound-title">
      <Compass className={styles.icon} size={32} strokeWidth={1.5} aria-hidden="true" />
      <h1 id="notfound-title" className={styles.title}>
        Page not found
      </h1>
      <p className={styles.blurb}>
        There is nothing at <code>{pathname}</code>. It may have moved, or the link may be mistyped.
      </p>
      <Link to="today" className={styles.link}>
        Go to Today
      </Link>
    </section>
  )
}
