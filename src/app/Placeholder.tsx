import { Link, useRoute } from './router'
import { ROUTES } from './router/routes'
import { NAV } from './layout/nav'
import { Sparkles } from 'lucide-react'
import styles from './Placeholder.module.css'

/** Stand-in for a route whose feature has not shipped yet: says what will live here and when. */
export function Placeholder({ phase }: { phase: number }) {
  const route = useRoute()
  const def = ROUTES[route.name]
  const nav = Object.values(NAV).find((item) => item.match.includes(route.name))
  const Icon = nav?.icon ?? Sparkles

  return (
    <section className={styles.root} aria-labelledby="placeholder-title">
      <Icon className={styles.icon} size={32} strokeWidth={1.5} aria-hidden="true" />
      <h1 id="placeholder-title" className={styles.title}>
        {def.title}
      </h1>
      <p className={styles.blurb}>{def.blurb}</p>
      <p className={styles.meta}>Coming soon · Phase {phase}</p>
      {route.name !== 'today' ? (
        <Link to="today" className={styles.link}>
          Back to Today
        </Link>
      ) : null}
    </section>
  )
}
