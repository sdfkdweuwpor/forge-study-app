import { CircleAlert } from 'lucide-react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Modal } from '@/ui/Modal'
import { EveningShutdown } from './EveningShutdown'
import { MorningPlan } from './MorningPlan'
import { RoutinePicker, SaveRoutine } from './RoutineDialogs'
import { clearRitualDialog, useOpenRitualDialog, type OpenDialog } from './store'
import { useDialogLifecycle } from './useDialog'

/**
 * Slot `global.overlays`: shows whichever ritual dialog was asked for (palette, shortcut, Today's card,
 * Settings). It renders nothing while none is open. A dialog that cannot load its data shows a short
 * apology with a way to try again, and never takes the page down.
 */
export function RitualsHost() {
  const dialog = useOpenRitualDialog()
  if (dialog === null) return null
  return (
    <ErrorBoundary
      key={dialog.session}
      fallback={(_error, reset) => <DialogFailed dialog={dialog} onRetry={reset} />}
    >
      <Active dialog={dialog} />
    </ErrorBoundary>
  )
}

function Active({ dialog }: { dialog: OpenDialog }) {
  const onGone = () => clearRitualDialog(dialog.session)
  switch (dialog.kind) {
    case 'morning':
      return <MorningPlan onGone={onGone} />
    case 'evening':
      return <EveningShutdown onGone={onGone} />
    case 'routine':
      return <RoutinePicker onGone={onGone} />
    case 'saveRoutine':
      return <SaveRoutine onGone={onGone} />
  }
}

const NAMES = {
  morning: 'Morning plan',
  evening: 'Evening shutdown',
  routine: 'Add a routine',
  saveRoutine: 'Save as a routine',
} as const

function DialogFailed({ dialog, onRetry }: { dialog: OpenDialog; onRetry: () => void }) {
  const { open, close } = useDialogLifecycle(() => clearRitualDialog(dialog.session))
  return (
    <Modal open={open} onClose={close} title={NAMES[dialog.kind]} size="sm">
      <EmptyState
        size="sm"
        titleAs="h3"
        icon={<CircleAlert />}
        title="Couldn’t open this"
        description="Nothing was changed, and your data is safe. Try again, or close this and come back."
        action={
          <>
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
          </>
        }
      />
    </Modal>
  )
}
