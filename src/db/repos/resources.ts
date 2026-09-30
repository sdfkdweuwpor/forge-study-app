/**
 * The resource library of a course (BRIEF §5.11): links, PDFs and notes, each "to read" or "done", kept in
 * a manual order. `Resource.milestoneId` is the course; `goalId` is copied from it so a goal's cascade
 * (trash) can find its resources without walking the courses.
 *
 * A PDF's bytes live in `files` (`repos/files.ts`): `createPdfResource` writes the file and its resource in
 * one transaction, so there is never a resource without its file or a file nobody points at.
 *
 * Deleting goes through the Trash (`moveToTrash('resources', id)`), which takes the file along, so Undo
 * (and Restore on the Trash page) brings both back. A course or goal moved to the Trash takes all of its
 * resources and their files with it in the same way (`repos/trash.ts`).
 *
 * Input is checked here as well as in the form: a link is http or https only, and a PDF must be under 50 MB
 * and really start with `%PDF-`. Errors that a person can fix are `ResourceError`s with a calm message.
 */
import { newId } from '@/lib/ids'
import {
  URL_MESSAGES,
  hasPdfHeader,
  nextOrder,
  parseWebUrl,
  pdfProblem,
  pdfProblemMessage,
  resourceReorderPlan,
  sortResources,
  titleFromFileName,
  titleFromNote,
  titleFromUrl,
} from '@/logic/resources'
import { UndoRefusedError } from '@/logic/undo'
import { db } from '../db'
import type { ID, Resource, StoredFile } from '../types'
import { storeFile } from './files'
import type { RepoOptions, Undoable } from './tasks'
import { moveToTrash, restoreFromTrash } from './trash'

export type ResourceErrorReason = 'course-missing' | 'url' | 'file' | 'title'

/** Something a person can fix: a bad link, a file that cannot be stored, an empty note. `message` is fit to show. */
export class ResourceError extends Error {
  readonly reason: ResourceErrorReason
  constructor(reason: ResourceErrorReason, message: string) {
    super(message)
    this.name = 'ResourceError'
    this.reason = reason
  }
}

/** The longest title or note. A title is a line and a note is a page, not a document. */
export const RESOURCE_TITLE_MAX = 200
export const RESOURCE_NOTES_MAX = 20_000

const clean = (text: string | undefined, max: number): string => (text ?? '').trim().slice(0, max)

/** A course's resources in their manual order. */
export async function listResources(milestoneId: ID): Promise<Resource[]> {
  return sortResources(await db.resources.where('milestoneId').equals(milestoneId).toArray())
}

export async function getResource(id: ID): Promise<Resource | undefined> {
  return db.resources.get(id)
}

/** The goal a course belongs to; throws when the course is not there (deleted in another tab, a stale page). */
async function goalOf(milestoneId: ID): Promise<ID> {
  const course = await db.milestones.get(milestoneId)
  if (!course) throw new ResourceError('course-missing', 'That course is no longer here.')
  return course.goalId
}

async function append(
  milestoneId: ID,
  fields: Pick<Resource, 'kind' | 'title' | 'url' | 'fileId' | 'notes'>,
  opts: RepoOptions,
): Promise<Resource> {
  const now = opts.now ?? Date.now()
  const goalId = await goalOf(milestoneId)
  const existing = await db.resources.where('milestoneId').equals(milestoneId).toArray()
  const resource: Resource = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    goalId,
    milestoneId,
    status: 'toRead',
    order: nextOrder(existing),
    ...fields,
  }
  await db.resources.add(resource)
  return resource
}

export interface LinkInput {
  url: string
  /** Left blank, the title is made from the address. */
  title?: string
  notes?: string
}

/** Adds a web link (http or https only) at the end of the course's list. */
export async function createLinkResource(
  milestoneId: ID,
  input: LinkInput,
  opts: RepoOptions = {},
): Promise<Resource> {
  const parsed = parseWebUrl(input.url)
  if (!parsed.ok) throw new ResourceError('url', URL_MESSAGES[parsed.problem])
  return db.transaction('rw', db.resources, db.milestones, () =>
    append(
      milestoneId,
      {
        kind: 'link',
        title: clean(input.title, RESOURCE_TITLE_MAX) || titleFromUrl(parsed.url),
        url: parsed.url,
        fileId: null,
        notes: clean(input.notes, RESOURCE_NOTES_MAX),
      },
      opts,
    ),
  )
}

export interface NoteInput {
  /** Left blank, the title is the first line of the body. */
  title?: string
  notes: string
}

/** Adds a note. A note needs a title or some text. */
export async function createNoteResource(
  milestoneId: ID,
  input: NoteInput,
  opts: RepoOptions = {},
): Promise<Resource> {
  const notes = clean(input.notes, RESOURCE_NOTES_MAX)
  const title = clean(input.title, RESOURCE_TITLE_MAX)
  if (title === '' && notes === '') {
    throw new ResourceError('title', 'Give the note a title or write something first.')
  }
  return db.transaction('rw', db.resources, db.milestones, () =>
    append(
      milestoneId,
      { kind: 'note', title: title || titleFromNote(notes), url: null, fileId: null, notes },
      opts,
    ),
  )
}

export interface PdfInput {
  /** The PDF's bytes: a `File` from an input, a drop or the clipboard. */
  blob: Blob
  /** The file name, kept on the stored file ("C182 study guide.pdf"). */
  name: string
  /** Left blank, the title is made from the file name. */
  title?: string
  notes?: string
}

/**
 * Stores a PDF and adds its resource, in one transaction. The Blob is kept as `application/pdf` whatever
 * the sender called it, so opening it can never be served as a page. Refused when it is over 50 MB, empty,
 * not called a PDF, or does not start like one.
 */
export async function createPdfResource(
  milestoneId: ID,
  input: PdfInput,
  opts: RepoOptions = {},
): Promise<{ resource: Resource; file: StoredFile }> {
  const facts = { name: input.name, type: input.blob.type, size: input.blob.size }
  const problem = pdfProblem(facts)
  if (problem !== null) throw new ResourceError('file', pdfProblemMessage(problem, facts))
  // Read before the transaction opens: a transaction must not wait on anything but Dexie.
  const head = new Uint8Array(await input.blob.slice(0, 1024).arrayBuffer())
  if (!hasPdfHeader(head)) {
    throw new ResourceError('file', `“${input.name}” doesn’t look like a PDF, so it wasn’t added.`)
  }
  const bytes = new Blob([input.blob], { type: 'application/pdf' })
  return db.transaction('rw', db.resources, db.milestones, db.files, async () => {
    const file = await storeFile(bytes, { name: input.name, mime: 'application/pdf' }, opts)
    const resource = await append(
      milestoneId,
      {
        kind: 'pdf',
        title: clean(input.title, RESOURCE_TITLE_MAX) || titleFromFileName(input.name),
        url: null,
        fileId: file.id,
        notes: clean(input.notes, RESOURCE_NOTES_MAX),
      },
      opts,
    )
    return { resource, file }
  })
}

export interface ResourcePatch {
  title?: string
  /** Links only; checked like a new link. */
  url?: string
  notes?: string
}

/**
 * Edits a resource's title, link or notes. A title left blank falls back the way it does when adding: the
 * address for a link, the first line for a note, the file name for a PDF. `null` when the resource is gone.
 */
export async function updateResource(
  id: ID,
  patch: ResourcePatch,
  opts: RepoOptions = {},
): Promise<Resource | null> {
  const now = opts.now ?? Date.now()
  let nextUrl: string | undefined
  if (patch.url !== undefined) {
    const parsed = parseWebUrl(patch.url)
    if (!parsed.ok) throw new ResourceError('url', URL_MESSAGES[parsed.problem])
    nextUrl = parsed.url
  }
  return db.transaction('rw', db.resources, db.files, async () => {
    const current = await db.resources.get(id)
    if (!current) return null
    const changes: Partial<Resource> = {}

    const url = current.kind === 'link' && nextUrl !== undefined ? nextUrl : current.url
    if (current.kind === 'link' && url !== current.url && url !== null) changes.url = url

    const notes = patch.notes === undefined ? current.notes : clean(patch.notes, RESOURCE_NOTES_MAX)
    if (notes !== current.notes) changes.notes = notes

    if (patch.title !== undefined || changes.url !== undefined) {
      let title = clean(patch.title ?? current.title, RESOURCE_TITLE_MAX)
      // A title that was only ever made from the old address follows the new one.
      if (
        changes.url !== undefined &&
        current.url !== null &&
        title === titleFromUrl(current.url)
      ) {
        title = ''
      }
      if (title === '') {
        if (current.kind === 'link') title = titleFromUrl(url ?? '')
        else if (current.kind === 'note') title = titleFromNote(notes)
        else {
          const file = current.fileId ? await db.files.get(current.fileId) : undefined
          title = titleFromFileName(file?.name ?? '')
        }
      }
      if (title !== current.title) changes.title = title
    }

    if (Object.keys(changes).length === 0) return current
    changes.updatedAt = now
    await db.resources.update(id, changes)
    return { ...current, ...changes }
  })
}

/** Marks a resource to read or done. `null` when it is gone. */
export async function setResourceStatus(
  id: ID,
  status: Resource['status'],
  opts: RepoOptions = {},
): Promise<Resource | null> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.resources, async () => {
    const current = await db.resources.get(id)
    if (!current) return null
    if (current.status === status) return current
    await db.resources.update(id, { status, updatedAt: now })
    return { ...current, status, updatedAt: now }
  })
}

/**
 * Puts the listed resources of a course in the given order. The listed rows swap the positions they held,
 * so reordering the "To read" tab leaves the done ones where they are. Returns how many rows were written.
 */
export async function reorderResources(
  milestoneId: ID,
  orderedIds: readonly ID[],
  opts: RepoOptions = {},
): Promise<number> {
  const now = opts.now ?? Date.now()
  return db.transaction('rw', db.resources, async () => {
    const rows = await db.resources.where('milestoneId').equals(milestoneId).toArray()
    const changes = resourceReorderPlan(rows, orderedIds)
    for (const { id, order } of changes) await db.resources.update(id, { order, updatedAt: now })
    return changes.length
  })
}

export interface DeletedResource extends Undoable {
  /** The Trash entry that holds the resource (and its file). */
  trashId: ID
}

/**
 * Moves a resource, and its file when it has one, to the Trash. `null` when it is already gone. `undo`
 * puts both back; if the course has been deleted since, it says so instead of restoring a resource into a
 * course that is not there (the resource stays in the Trash and comes back with its course).
 */
export async function deleteResource(id: ID): Promise<DeletedResource | null> {
  const trashed = await moveToTrash('resources', id)
  if (!trashed) return null
  const milestoneId = ((trashed.item.payload.resources ?? [])[0] as Resource | undefined)
    ?.milestoneId
  return {
    trashId: trashed.trashId,
    undo: async () => {
      if (milestoneId !== undefined && (await db.milestones.get(milestoneId)) === undefined) {
        // The toast says this as it is and offers no Retry: trying again would find the same thing.
        throw new UndoRefusedError(
          'Its course is in the Trash now. Restore the course to get this back.',
        )
      }
      await restoreFromTrash(trashed.trashId)
    },
  }
}
