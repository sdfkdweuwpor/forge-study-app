import { useEffect, useRef } from 'react'
import { Link, navigate, useParams, usePageTitle } from '@/app/router'
import { Button } from '@/ui/Button'
import { openRitualDialog, useOpenRitualDialog } from './store'
import styles from './RitualRoute.module.css'

const COPY = {
  morning: {
    name: 'Morning plan',
    lede: 'Pick your top 3 for today, look over the goal work already planned, and set your focus goal. About two minutes.',
  },
  evening: {
    name: 'Evening shutdown',
    lede: 'See what got done, move what is open to tomorrow, and leave one line for yourself.',
  },
} as const

/**
 * `/rituals/morning` and `/rituals/evening`: a link that opens the dialog (for a bookmark, a launcher
 * shortcut or a reminder). The dialogs are not pages, so this page is only what sits behind the dialog
 * for a moment: its heading, one line and the way back. When the dialog has been closed, whether it
 * was finished or not, the page moves on to Today, replacing its own history entry so Back does not
 * return here. Any other kind goes straight to Today.
 */
export default function RitualRoute() {
  const { kind } = useParams<'ritual'>()
  const known = kind === 'morning' || kind === 'evening'
  const dialog = useOpenRitualDialog()
  const wasOpen = useRef(false)
  usePageTitle(known ? COPY[kind].name : undefined)

  useEffect(() => {
    if (known) openRitualDialog(kind)
    else navigate('today', undefined, { replace: true })
  }, [known, kind])

  useEffect(() => {
    if (dialog !== null) wasOpen.current = true
    else if (wasOpen.current) navigate('today', undefined, { replace: true })
  }, [dialog])

  if (!known) return null
  const copy = COPY[kind]
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{copy.name}</h1>
      <p className={styles.lede}>{copy.lede}</p>
      <div className={styles.actions}>
        <Button variant="primary" onClick={() => openRitualDialog(kind)}>
          Open the {copy.name.toLowerCase()}
        </Button>
        <Link to="today" replace className={styles.link}>
          Go to Today
        </Link>
      </div>
    </div>
  )
}
