import { useMemo } from 'react'
import { recordError } from '@/app/reportError'
import { navigate } from '@/app/router'
import { convertParkingItem, deleteParkingItem, setParkingStatus } from '@/db/repos/parking'
import type { ParkingItem } from '@/db/types'
import { useToast } from '@/ui/Toast'

export interface ParkedActions {
  /** Makes an Inbox task of the thought. */
  convert: (item: ParkingItem) => Promise<void>
  /** Marks it done: dealt with, no task needed. */
  done: (item: ParkingItem) => Promise<void>
  remove: (item: ParkingItem) => Promise<void>
}

function shorten(text: string, max = 48): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/**
 * What the buttons on a parked thought do, with a toast that can undo each one. Errors are reported and
 * say that nothing changed; a thought that is already gone (another tab dealt with it) is left alone.
 */
export function useParkedActions(): ParkedActions {
  const toast = useToast()
  return useMemo<ParkedActions>(() => {
    const failed = (error: unknown, what: string) => {
      recordError(error, what)
      toast.error(`Couldn’t ${what}`, { description: 'Nothing was changed. Try again.' })
    }
    return {
      convert: async (item) => {
        try {
          const made = await convertParkingItem(item.id)
          if (!made) return
          toast.show({
            title: 'Added to your tasks',
            description: shorten(item.text),
            variant: 'success',
            undo: made.undo,
            action: { label: 'Open', onClick: () => navigate('task', { taskId: made.task.id }) },
          })
        } catch (error) {
          failed(error, 'make a task')
        }
      },
      done: async (item) => {
        try {
          const changed = await setParkingStatus(item.id, 'done')
          if (!changed) return
          toast.show({ title: 'Marked done', description: shorten(item.text), undo: changed.undo })
        } catch (error) {
          failed(error, 'mark that done')
        }
      },
      remove: async (item) => {
        try {
          const removed = await deleteParkingItem(item.id)
          if (!removed) return
          toast.show({ title: 'Deleted', description: shorten(item.text), undo: removed.undo })
        } catch (error) {
          failed(error, 'delete that')
        }
      },
    }
  }, [toast])
}
