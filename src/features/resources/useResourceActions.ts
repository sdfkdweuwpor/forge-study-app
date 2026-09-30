import { useMemo } from 'react'
import { recordError } from '@/app/reportError'
import {
  ResourceError,
  createLinkResource,
  createNoteResource,
  createPdfResource,
  deleteResource,
  reorderResources,
  setResourceStatus,
  updateResource,
  type ResourcePatch,
} from '@/db/repos/resources'
import type { ID, Resource } from '@/db/types'
import { formatBytes } from '@/logic/retention'
import { useToast } from '@/ui/Toast'
import { downloadPdf, openPdf } from './openFile'

/** A write from a form: the saved resource, or a sentence for the form to show. */
export type FormOutcome = { ok: true; resource: Resource } | { ok: false; message: string }

export interface ResourceActions {
  addLink: (input: { url: string; title: string }) => Promise<FormOutcome>
  addNote: (input: { title: string; notes: string }) => Promise<FormOutcome>
  /**
   * Stores each file in turn (one at a time, so a big file never races another) and reports once: what was
   * added, and why anything was turned away, including `earlier` problems found before this call.
   * Returns the resources that were added.
   */
  addPdfs: (files: readonly File[], earlier?: readonly string[]) => Promise<Resource[]>
  edit: (id: ID, patch: ResourcePatch) => Promise<FormOutcome>
  /** Returns whether the change was written. */
  setStatus: (resource: Resource, status: Resource['status']) => Promise<boolean>
  /** Moves it to the Trash with an Undo toast. Returns whether it was deleted. */
  remove: (resource: Resource) => Promise<boolean>
  /** Returns whether the order was written. */
  reorder: (orderedIds: readonly ID[]) => Promise<boolean>
  open: (resource: Resource) => Promise<void>
  download: (resource: Resource) => Promise<void>
}

const UNEXPECTED = 'Something went wrong, so nothing was saved. Please try again.'

/** A quota error from the browser, however it is wrapped. */
function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'QuotaExceededError') return true
  const cause = error.cause
  return (
    (cause instanceof Error && cause.name === 'QuotaExceededError') || /quota/i.test(error.message)
  )
}

const shorten = (text: string, max = 48): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text

/**
 * What the panel's controls do for one course. A mistake a person can fix (a bad link, the wrong kind of
 * file) comes back as a sentence; anything unexpected is logged and shown in a toast that says nothing was
 * changed. Deleting moves to the Trash with an Undo toast.
 */
export function useResourceActions(courseId: ID): ResourceActions {
  const toast = useToast()
  return useMemo<ResourceActions>(() => {
    const failed = (error: unknown, what: string): void => {
      recordError(error, what)
      toast.error(`Couldn’t ${what}`, { description: 'Nothing was changed. Try again.' })
    }

    const outcome = async (
      run: () => Promise<Resource | null>,
      what: string,
    ): Promise<FormOutcome> => {
      try {
        const resource = await run()
        return resource === null
          ? { ok: false, message: 'That resource is no longer here.' }
          : { ok: true, resource }
      } catch (error) {
        if (error instanceof ResourceError) return { ok: false, message: error.message }
        failed(error, what)
        return { ok: false, message: UNEXPECTED }
      }
    }

    const missing = (): void => {
      toast.error('That file isn’t on this device', {
        description: 'It wasn’t included in the backup this came from. You can delete the row.',
      })
    }

    return {
      addLink: ({ url, title }) =>
        outcome(() => createLinkResource(courseId, { url, title }), 'add the link'),

      addNote: ({ title, notes }) =>
        outcome(() => createNoteResource(courseId, { title, notes }), 'add the note'),

      addPdfs: async (files, earlier = []) => {
        const added: { resource: Resource; size: number }[] = []
        const problems = [...earlier]
        for (const file of files) {
          try {
            const { resource } = await createPdfResource(courseId, { blob: file, name: file.name })
            added.push({ resource, size: file.size })
          } catch (error) {
            if (error instanceof ResourceError) problems.push(error.message)
            else if (isQuotaError(error)) {
              problems.push(
                `There isn’t enough space in your browser to save “${file.name}”. Free some space and try again.`,
              )
            } else {
              recordError(error, 'add a PDF')
              problems.push(`“${file.name}” couldn’t be saved, and nothing was changed.`)
            }
          }
        }
        const [first] = added
        if (first) {
          toast.success(added.length === 1 ? 'PDF added' : `${added.length} PDFs added`, {
            description:
              added.length === 1
                ? `${shorten(first.resource.title)} · ${formatBytes(first.size)}`
                : undefined,
          })
        }
        if (problems.length > 0) {
          toast.error(
            problems.length === 1 ? 'Couldn’t add that file' : `Couldn’t add ${problems.length} files`,
            { description: problems.join(' ') },
          )
        }
        return added.map((a) => a.resource)
      },

      edit: (id, patch) => outcome(() => updateResource(id, patch), 'save your changes'),

      setStatus: async (resource, status) => {
        try {
          return (await setResourceStatus(resource.id, status)) !== null
        } catch (error) {
          failed(error, 'update that')
          return false
        }
      },

      remove: async (resource) => {
        try {
          const deleted = await deleteResource(resource.id)
          if (!deleted) return false
          toast.show({
            title: 'Moved to the Trash',
            description: shorten(resource.title),
            undo: deleted.undo,
          })
          return true
        } catch (error) {
          failed(error, 'delete that')
          return false
        }
      },

      reorder: async (orderedIds) => {
        try {
          await reorderResources(courseId, orderedIds)
          return true
        } catch (error) {
          failed(error, 'save the new order')
          return false
        }
      },

      open: async (resource) => {
        if (resource.fileId === null) return
        try {
          const result = await openPdf(resource.fileId)
          if (result === 'missing') missing()
          else if (result === 'downloaded') {
            toast.show({
              title: 'Downloaded instead',
              description: 'Your browser blocked the new tab, so the PDF was saved to your device.',
            })
          }
        } catch (error) {
          failed(error, 'open the PDF')
        }
      },

      download: async (resource) => {
        if (resource.fileId === null) return
        try {
          if ((await downloadPdf(resource.fileId)) === 'missing') missing()
        } catch (error) {
          failed(error, 'download the PDF')
        }
      },
    }
  }, [toast, courseId])
}
