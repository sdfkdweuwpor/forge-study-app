import { Button } from '@/ui/Button'
import { ToastCard, ToastProvider, useToast } from '@/ui/Toast'
import type { DemoSection } from '../types'
import styles from './Overlays.demo.module.css'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function Controls() {
  const toast = useToast()
  return (
    <div className={styles.row}>
      <Button onClick={() => toast.show({ title: 'Session saved', description: '25 min on C182' })}>
        Default
      </Button>
      <Button onClick={() => toast.success('Goal created')}>Success</Button>
      <Button onClick={() => toast.error('Couldn’t sync', { description: 'You are offline.' })}>
        Error
      </Button>
      <Button onClick={() => toast.xp('Task completed', { description: '+15 XP', duration: 5000 })}>
        XP
      </Button>
      <Button
        onClick={() =>
          toast.show({
            title: 'Task moved to trash',
            description: 'Read chapter 4 · C182',
            undo: async () => {
              await wait(600)
            },
          })
        }
      >
        With Undo
      </Button>
      <Button
        variant="ghost"
        onClick={() =>
          toast.show({
            title: 'Task moved to trash',
            undo: async () => {
              await wait(500)
              throw new Error('offline')
            },
          })
        }
      >
        Undo fails
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          for (let i = 1; i <= 5; i += 1)
            toast.show({ title: `Reminder ${i} of 5`, duration: 6000 })
        }}
      >
        Queue of 5
      </Button>
      <Button variant="ghost" onClick={toast.dismissAll}>
        Dismiss all
      </Button>
    </div>
  )
}

function ToastDemo() {
  return (
    <div className={styles.stack}>
      <div className={styles.block}>
        <span className={styles.caption}>
          Pauses on hover and focus. Three at a time; the rest queue.
        </span>
        {/* The stack is positioned inside this box; in the app it is fixed to the window. */}
        <div className={styles.stage}>
          <ToastProvider inline>
            <Controls />
          </ToastProvider>
        </div>
        <span className={styles.note}>
          Bottom-right on desktop; bottom-centre above the tab bar below 640px.
        </span>
      </div>

      <div className={styles.block}>
        <span className={styles.caption}>Variants</span>
        <div className={styles.specimens}>
          <ToastCard
            title="Session saved"
            description="25 min on C182"
            onDismiss={() => undefined}
          />
          <ToastCard variant="success" title="Goal created" onDismiss={() => undefined} />
          <ToastCard
            variant="error"
            title="Couldn’t sync"
            description="You are offline."
            onDismiss={() => undefined}
          />
          <ToastCard
            variant="xp"
            title="Task completed"
            description="+15 XP"
            onDismiss={() => undefined}
          />
        </div>
      </div>

      <div className={styles.block}>
        <span className={styles.caption}>Undo: ready, working, done, failed</span>
        <div className={styles.specimens}>
          <ToastCard
            title="Task moved to trash"
            description="Read chapter 4 · C182"
            onUndo={() => undefined}
            onDismiss={() => undefined}
          />
          <ToastCard
            title="Task moved to trash"
            description="Read chapter 4 · C182"
            phase="undoing"
            onUndo={() => undefined}
            onDismiss={() => undefined}
          />
          <ToastCard title="Task moved to trash" phase="undone" onDismiss={() => undefined} />
          <ToastCard
            title="Task moved to trash"
            phase="undoFailed"
            onUndo={() => undefined}
            onDismiss={() => undefined}
          />
        </div>
      </div>
    </div>
  )
}

const section: DemoSection = {
  id: 'toast',
  title: 'Toast',
  group: 'Overlays',
  order: 40,
  description:
    'Transient messages with a queue, auto-dismiss that pauses on hover and focus, an optional Undo, and live-region announcements (assertive for errors).',
  render: () => <ToastDemo />,
}

export default section
