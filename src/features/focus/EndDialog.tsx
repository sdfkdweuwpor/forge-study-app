/**
 * "Done with this task?" (BRIEF §5.2): the question asked when a focus session ends. Yes completes the
 * task (with the XP toast and its Undo), Keep going starts another round, Add note saves a line on the
 * session. The `focus.afterSession` slot renders inside it, so later features (the parking lot's
 * review, the focus check-in) show up at the moment they matter.
 *
 * The provider mounts one, keyed by session id, so each session starts with a clean dialog.
 */
import { Check, CircleAlert, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { recordError } from '@/app/reportError'
import { Slot } from '@/app/registry'
import { completeTask } from '@/db/repos/tasks'
import { logNote } from '@/db/repos/sessions'
import { useTask } from '@/db/hooks/useTasks'
import type { ID, Session } from '@/db/types'
import { formatXp, relativeDay } from '@/logic/taskDisplay'
import { dayOf } from '@/logic/dates'
import { earnedXp, formatMinutes } from '@/logic/timer'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Modal } from '@/ui/Modal'
import { Skeleton } from '@/ui/Skeleton'
import { Textarea } from '@/ui/Textarea'
import { useToast } from '@/ui/Toast'
import { keepGoing } from './actions'
import { useSession } from './queries'
import styles from './EndDialog.module.css'

interface EndDialogProps {
  sessionId: ID | null
  open: boolean
  onClose: () => void
}

function shorten(text: string, max = 48): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** "25 of 25 min" for a planned session, "47 min" for a stopwatch. */
function minutesText(session: Session): string {
  const actual = session.actualMinutes ?? 0
  return session.plannedMinutes === null
    ? formatMinutes(actual)
    : `${actual} of ${session.plannedMinutes} min`
}

export default function EndDialog({ sessionId, open, onClose }: EndDialogProps) {
  const toast = useToast()
  const session = useSession(sessionId)
  const task = useTask(session?.taskId ?? undefined)
  const [noting, setNoting] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const loading = session === undefined || (session?.taskId != null && task === undefined)
  const gone = session === null
  const taskOpen = task != null && task.status !== 'done'

  // The dialog opens before its session and task have loaded, when the only button is Close. Once the
  // answers are there, focus (which fell to the page when Close went away) moves to the likely one.
  const answer = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!open || loading || noting) return
    const active = document.activeElement
    if (active === null || active === document.body || active.getAttribute('role') === 'dialog') {
      answer.current?.focus({ preventScroll: true })
    }
  }, [open, loading, noting])

  const complete = async () => {
    if (!task) return
    setBusy(true)
    try {
      const result = await completeTask(task.id)
      onClose()
      const parts = [
        result.xp > 0 ? formatXp(result.xp) : null,
        result.next?.dueDate
          ? `Next: ${relativeDay(result.next.dueDate, dayOf(Date.now()))}`
          : null,
      ].filter((part): part is string => part !== null)
      toast.show({
        title: `Completed “${shorten(task.title)}”`,
        ...(parts.length > 0 ? { description: parts.join(' · ') } : {}),
        variant: result.xp > 0 ? 'xp' : 'success',
        undo: result.undo,
      })
    } catch (error) {
      recordError(error, 'completeTask')
      toast.error('Couldn’t complete the task', { description: 'Nothing was changed. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  const more = () => {
    if (!session) return
    onClose()
    void keepGoing(session)
  }

  const saveNote = async () => {
    if (!session) return
    setBusy(true)
    try {
      await logNote(session.id, draft)
      setNoting(false)
      setSaved(true)
    } catch (error) {
      recordError(error, 'logNote')
      toast.error('Couldn’t save the note', { description: 'Try again.' })
    } finally {
      setBusy(false)
    }
  }

  const footer = noting ? (
    <>
      <Button variant="ghost" disabled={busy} onClick={() => setNoting(false)}>
        Cancel
      </Button>
      <Button variant="primary" loading={busy} onClick={() => void saveNote()}>
        Save note
      </Button>
    </>
  ) : loading || gone ? (
    <Button variant="secondary" onClick={onClose}>
      Close
    </Button>
  ) : (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          setDraft(session?.note ?? '')
          setSaved(false)
          setNoting(true)
        }}
      >
        Add note
      </Button>
      <Button
        variant={taskOpen ? 'secondary' : 'primary'}
        iconLeft={<Play />}
        disabled={busy}
        // The answer that is most likely is the one focus starts on: "Yes", or "Keep going" with no task to finish.
        data-autofocus={taskOpen ? undefined : ''}
        ref={taskOpen ? undefined : answer}
        onClick={more}
      >
        Keep going
      </Button>
      {taskOpen ? (
        <Button
          variant="primary"
          iconLeft={<Check />}
          loading={busy}
          data-autofocus=""
          ref={answer}
          onClick={() => void complete()}
        >
          Yes
        </Button>
      ) : null}
    </>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={taskOpen ? 'Done with this task?' : 'Session complete'}
      description={task ? task.title : undefined}
      footer={footer}
    >
      {loading ? (
        <div
          className={styles.body}
          role="status"
          aria-busy="true"
          aria-label="Loading the session"
        >
          <Skeleton width="55%" />
          <Skeleton width="80%" />
        </div>
      ) : gone || !session ? (
        <EmptyState
          size="sm"
          icon={<CircleAlert />}
          title="This session is no longer here"
          description="It may have been removed. Your other sessions are safe."
        />
      ) : (
        <div className={styles.body}>
          <p className={styles.summary} data-testid="end-summary">
            <span>{minutesText(session)}</span>
            {session.counted ? (
              <span className={styles.xp}>{formatXp(earnedXp(session))}</span>
            ) : null}
          </p>
          {!session.counted ? (
            <p className={styles.muted}>
              {session.plannedMinutes === null
                ? 'A stopwatch session counts from 10 minutes, so this one did not earn XP.'
                : 'Sessions under 80% of the plan do not count toward XP or your daily goal.'}
            </p>
          ) : null}

          {noting ? (
            <Textarea
              label="Note"
              hint="A line for your log: what you covered, or where you stopped."
              value={draft}
              minRows={3}
              maxRows={8}
              data-autofocus=""
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : session.note ? (
            <p className={styles.note}>
              <span className={styles.noteLabel}>{saved ? 'Note saved' : 'Note'}</span>
              {session.note}
            </p>
          ) : null}

          <Slot id="focus.afterSession" sessionId={session.id} />
        </div>
      )}
    </Modal>
  )
}
