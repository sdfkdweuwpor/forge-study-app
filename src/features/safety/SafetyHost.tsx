import { useEffect } from 'react'
import { useToast } from '@/ui/Toast'
import { formatBytes, whenLabel } from '@/logic/retention'
import { restoreAndReload, snapshotNow } from './actions'
import { listenForSnapshotNow } from './commandBus'
import { useTrashCount } from './queries'
import { takeRestoreNotice } from './restoreNotice'
import { publishTrashCount } from './trashCount'

/**
 * Renders nothing (slot `global.overlays`). It takes the snapshot asked for by the palette or `o s` and
 * shows the toast, and tells someone whose restore just reloaded the app what came back, with an Undo that
 * restores the snapshot taken of the data as it was just before.
 */
export function SafetyHost() {
  const toast = useToast()
  const trashCount = useTrashCount()

  // The palette hides "Empty Trash…" while the Trash is empty; its `when` reads this.
  useEffect(() => {
    publishTrashCount(trashCount)
  }, [trashCount])

  useEffect(
    () =>
      listenForSnapshotNow(() => {
        void snapshotNow().then((out) => {
          if (out.ok) {
            toast.success('Snapshot saved', {
              description: `${formatBytes(out.info.sizeBytes)} · find it in Settings, Snapshots.`,
            })
          } else toast.error('Snapshot failed', { description: out.message })
        })
      }),
    [toast],
  )

  useEffect(() => {
    const notice = takeRestoreNotice()
    if (!notice) return
    if (notice.kind === 'undo') {
      toast.success('Restore undone', {
        description: 'Your data is back as it was before the restore.',
      })
      return
    }
    toast.success('Snapshot restored', {
      description: `${notice.items.toLocaleString('en-US')} items from ${whenLabel(notice.takenAt, Date.now())}. Attached PDFs were left as they are.`,
      duration: 15_000,
      undo: async () => {
        const out = await restoreAndReload(notice.preRestoreId, notice.takenAt, 'undo')
        if (!out.ok) throw new Error(out.message)
      },
    })
  }, [toast])

  return null
}
