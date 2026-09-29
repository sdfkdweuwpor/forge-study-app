/**
 * A small running timer that links to `/focus`: in the sidebar (`sidebar.timer`, also inside the tablet
 * drawer) and, on a phone, as a pill above the tab bar (`global.overlays`). It shows nothing while no
 * session runs and while the Focus page itself is open. It is a link, not a live region: the polite
 * announcements in `TimerProvider` do the speaking.
 */
import { Link, useRoute } from '@/app/router'
import { formatClock, phaseLabel, spokenClock, variantOf } from '@/logic/timer'
import { ProgressRing } from '@/ui/ProgressRing'
import { useSettings } from '@/db/hooks/useSettings'
import { useTimer } from './useTimer'
import styles from './MiniTimer.module.css'

function MiniTimerLink({ variant }: { variant: 'sidebar' | 'pill' }) {
  const timer = useTimer()
  const settings = useSettings()
  const route = useRoute()
  const session = timer.session
  if (!session || route.name === 'focus') return null

  const paused = timer.status === 'paused'
  const label = phaseLabel(variantOf(session, settings?.timer ?? { longBreakEvery: 4 }))
  // Spoken to the minute: a per-second name would be re-read whenever the link is focused.
  const spoken = spokenClock(Math.ceil(timer.seconds / 60) * 60)
  const description =
    session.plannedMinutes === null ? `${spoken} elapsed` : `about ${spoken} left`

  return (
    <Link
      to="focus"
      className={styles.mini}
      data-variant={variant}
      data-paused={paused || undefined}
      data-testid={variant === 'pill' ? 'mini-timer-pill' : 'mini-timer'}
      aria-label={`${label}${paused ? ' paused' : ''}, ${description}. Open Focus`}
    >
      <ProgressRing
        aria-hidden="true"
        label="Session progress"
        value={timer.progress}
        max={1}
        size={variant === 'pill' ? 20 : 22}
        stroke={3}
        tone={session.kind === 'break' ? 'success' : 'accent'}
      />
      <span className={styles.time}>{formatClock(timer.seconds)}</span>
      <span className={styles.label}>{paused ? `${label} · paused` : label}</span>
    </Link>
  )
}

/** Slot `sidebar.timer`. */
export function SidebarTimer() {
  return <MiniTimerLink variant="sidebar" />
}

/** Slot `global.overlays`; shown only below 640px by its CSS. */
export function MobileTimer() {
  return <MiniTimerLink variant="pill" />
}
