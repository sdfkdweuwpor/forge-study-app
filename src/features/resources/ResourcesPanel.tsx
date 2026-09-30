import { BookMarked, FileText, Link as LinkIcon, Plus, StickyNote } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { setQuery, useQuery } from '@/app/router'
import { useShortcutHandler } from '@/app/shortcuts'
import type { ID } from '@/db/types'
import {
  FILTER_LABELS,
  countByStatus,
  defaultFilter,
  filterResources,
  looksLikePdf,
  lowStorageMessage,
  partitionPdfs,
  storageIsLow,
  type ResourceFilter,
  type StorageEstimateLike,
} from '@/logic/resources'
import { Button } from '@/ui/Button'
import { Dropdown, type MenuEntry } from '@/ui/Dropdown'
import { EmptyState } from '@/ui/EmptyState'
import { Kbd } from '@/ui/Kbd'
import { Modal } from '@/ui/Modal'
import { Skeleton } from '@/ui/Skeleton'
import { Tabs, type TabItem } from '@/ui/Tabs'
import { ResourceForm } from './ResourceForm'
import { ResourceRow } from './ResourceRow'
import { ResourceSortable } from './ResourceSortable'
import { useCourseResources, type ResourceView } from './queries'
import { useResourceActions } from './useResourceActions'
import styles from './ResourcesPanel.module.css'

/** What the browser says about its free space, or nothing when it cannot say. */
async function readStorageEstimate(): Promise<StorageEstimateLike | null> {
  try {
    return (await navigator.storage?.estimate?.()) ?? null
  } catch {
    return null
  }
}

const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files')

/** After the row you acted on has left the list: the next one, else the one before it. */
function neighbourOf(list: readonly { id: ID }[], id: ID): ID | null {
  const at = list.findIndex((r) => r.id === id)
  if (at === -1) return null
  return (list[at + 1] ?? list[at - 1])?.id ?? null
}

/** Runs `fn` after React has drawn what the write changed. */
function afterPaint(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn))
}

interface Reveal {
  /** The row to bring into view, or `null` for the panel itself. */
  id: ID | null
  /** Move keyboard focus there (the palette opened the page here); adding a row only scrolls to it. */
  focus: boolean
  /** Just added: the row is on its way from the database, so wait for it instead of giving up. */
  fresh?: boolean
}

interface PendingSave {
  files: File[]
  earlier: string[]
  message: string
}

/**
 * The "Resources" panel of a course page (slot `course.panels`, BRIEF §5.11): links, PDFs kept on this
 * device, and notes, each to read or done. A failure to read shows a calm message inside the panel and never
 * takes the course page down.
 */
export function ResourcesPanel({ courseId }: { goalId: string; courseId: string }) {
  return (
    <ErrorBoundary
      resetKey={courseId}
      fallback={(_error, reset) => (
        <section className={styles.panel} aria-label="Resources">
          <h2 className={styles.title}>Resources</h2>
          <p className={styles.quiet}>Couldn’t load the resources for this course. They are safe.</p>
          <div>
            <Button size="sm" onClick={reset}>
              Try again
            </Button>
          </div>
        </section>
      )}
    >
      <ResourcesBody courseId={courseId} />
    </ErrorBoundary>
  )
}

function ResourcesBody({ courseId }: { courseId: ID }) {
  const resources = useCourseResources(courseId)
  const actions = useResourceActions(courseId)
  const query = useQuery()

  const [filter, setFilter] = useState<ResourceFilter | null>(null)
  const [composer, setComposer] = useState<'link' | 'note' | null>(null)
  const [editingId, setEditingId] = useState<ID | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingSave | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [draft, setDraft] = useState<{ ids: ID[]; base: readonly ResourceView[] } | null>(null)

  const root = useRef<HTMLElement | null>(null)
  const heading = useRef<HTMLHeadingElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const dragDepth = useRef(0)
  const handled = useRef<Reveal | null>(null)
  const headingId = useId()

  const counts = useMemo(() => countByStatus(resources ?? []), [resources])
  const active: ResourceFilter = filter ?? 'all'
  const visible = useMemo(() => filterResources(resources ?? [], active), [resources, active])

  // The palette opens the course page with ?panel=resources[&resource=<id>]: show that row (under All, so
  // it cannot be hidden by a filter), scroll to it and move focus there. The flag is then dropped from the
  // address. Derived while rendering, as the goal page's import panel does.
  const asked = query.panel === 'resources'
  const [seen, setSeen] = useState(false)
  if (asked !== seen) {
    setSeen(asked)
    if (asked) {
      const id = query.resource ?? null
      setReveal({ id, focus: true })
      if (id !== null) setFilter('all')
    }
  }
  useEffect(() => {
    if (asked) setQuery({ panel: undefined, resource: undefined })
  }, [asked])

  // A course opens on To read while anything waits there, else on All. Chosen once, when the rows arrive,
  // so ticking one off does not swap the tab under the person's hands.
  if (filter === null && resources !== undefined) {
    setFilter((current) => current ?? defaultFilter(countByStatus(resources)))
  }

  const rowElement = useCallback(
    (id: ID): HTMLElement | null =>
      root.current?.querySelector<HTMLElement>(`[data-resource-id="${CSS.escape(id)}"]`) ?? null,
    [],
  )

  // Bring the wanted row (or the panel) into view once it is drawn.
  useEffect(() => {
    if (reveal === null || resources === undefined || handled.current === reveal) return
    const panel = root.current
    if (!panel) return
    const row = reveal.id === null ? null : rowElement(reveal.id)
    // Not drawn yet: it is on its way (just added) or the list has not caught up.
    if (reveal.id !== null && row === null && (reveal.fresh || resources.some((r) => r.id === reveal.id))) {
      return
    }
    handled.current = reveal
    if (row === null) {
      panel.scrollIntoView({ block: 'start' })
      if (reveal.focus) heading.current?.focus({ preventScroll: true })
      return
    }
    row.scrollIntoView({ block: 'center' })
    if (reveal.focus) {
      const target =
        row.querySelector<HTMLElement>('[data-row-title]:is(a, button)') ??
        row.querySelector<HTMLElement>('input[type="checkbox"]')
      target?.focus({ preventScroll: true })
    }
  }, [reveal, resources, visible, rowElement])

  const announce = useCallback((text: string) => setAnnouncement(text), [])

  const focusAdd = useCallback(() => {
    root.current?.querySelector<HTMLElement>('[data-role="add"]')?.focus()
  }, [])

  const focusRowMenu = useCallback(
    (id: ID) => {
      afterPaint(() => {
        const menu = rowElement(id)?.querySelector<HTMLElement>('button[aria-haspopup="menu"]')
        ;(menu ?? heading.current)?.focus()
      })
    },
    [rowElement],
  )

  /** Keeps keyboard focus in the list when the row that had it leaves. */
  const focusNeighbour = useCallback(
    (id: ID | null) => {
      afterPaint(() => {
        const box = id === null ? null : rowElement(id)?.querySelector<HTMLElement>('input[type="checkbox"]')
        const tab = root.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
        ;(box ?? tab ?? heading.current)?.focus()
      })
    },
    [rowElement],
  )

  const openComposer = useCallback(
    (kind: 'link' | 'note') => {
      setEditingId(null)
      setComposer(kind)
      root.current?.scrollIntoView({ block: 'nearest' })
    },
    [],
  )

  const pickPdfs = useCallback(() => fileInput.current?.click(), [])

  /** The person chose not to save: report what was turned away before that, then close. */
  function cancelPending(): void {
    if (pending && pending.earlier.length > 0) void actions.addPdfs([], pending.earlier)
    setPending(null)
  }

  useShortcutHandler('resources.add', () => {
    root.current?.scrollIntoView({ block: 'nearest' })
    setMenuOpen(true)
  })
  useShortcutHandler('resources.addLink', () => openComposer('link'))
  useShortcutHandler('resources.addNote', () => openComposer('note'))
  useShortcutHandler('resources.addPdf', pickPdfs)

  // ── Adding PDFs: the file button, a drop on the panel, or a paste ──────────────────────────────────

  const save = useCallback(
    async (files: File[], earlier: string[]) => {
      setBusy(true)
      try {
        const added = await actions.addPdfs(files, earlier)
        const [first] = added
        if (first) {
          setFilter((f) => (f === 'done' ? 'toRead' : f))
          setReveal({ id: first.id, focus: false, fresh: true })
          announce(added.length === 1 ? `Added PDF: ${first.title}` : `Added ${added.length} PDFs`)
        }
      } finally {
        setBusy(false)
      }
    },
    [actions, announce],
  )

  const intake = useCallback(
    async (offered: readonly File[]) => {
      if (offered.length === 0) return
      const { accepted, problems } = partitionPdfs(offered)
      if (accepted.length === 0) {
        await actions.addPdfs([], problems)
        return
      }
      // Tell the person before saving when the browser has little room left.
      const need = accepted.reduce((sum, f) => sum + f.size, 0)
      const estimate = await readStorageEstimate()
      if (storageIsLow(estimate, need)) {
        setPending({
          files: accepted,
          earlier: problems,
          message: lowStorageMessage(estimate, need, accepted.length),
        })
        return
      }
      await save(accepted, problems)
    },
    [actions, save],
  )

  const intakeRef = useRef(intake)
  useEffect(() => {
    intakeRef.current = intake
  })

  // Paste: a PDF on the clipboard (copied in the file manager) is added. Anything else is left alone.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const pdfs = Array.from(e.clipboardData?.files ?? []).filter(looksLikePdf)
      if (pdfs.length === 0) return
      e.preventDefault()
      void intakeRef.current(pdfs)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  function onFilesChosen(e: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // so choosing the same file again still fires
    void intake(files)
  }

  function onDragEnter(e: DragEvent): void {
    if (!hasFiles(e)) return
    dragDepth.current += 1
    setDragging(true)
  }
  function onDragOver(e: DragEvent): void {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  function onDragLeave(e: DragEvent): void {
    if (!hasFiles(e)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  function onDrop(e: DragEvent): void {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    void intake(Array.from(e.dataTransfer.files))
  }

  // ── Row actions ────────────────────────────────────────────────────────────────────────────────────

  async function toggle(r: ResourceView, done: boolean): Promise<void> {
    const leaves = active !== 'all' && (done ? active === 'toRead' : active === 'done')
    const next = leaves ? neighbourOf(visible, r.id) : null
    if (!(await actions.setStatus(r, done ? 'done' : 'toRead'))) return
    announce(`${r.title} marked ${done ? 'done' : 'to read'}`)
    if (leaves) focusNeighbour(next)
  }

  async function remove(r: ResourceView): Promise<void> {
    const next = neighbourOf(visible, r.id)
    if (!(await actions.remove(r))) return
    announce(`${r.title} moved to the Trash`)
    focusNeighbour(next)
  }

  async function reorder(ids: ID[]): Promise<void> {
    setDraft({ ids, base: visible })
    if (!(await actions.reorder(ids))) setDraft(null)
  }

  // The order you dropped stays on screen until the database has caught up.
  const shown = useMemo(() => {
    if (draft === null || draft.base !== visible) return visible
    const byId = new Map(visible.map((r) => [r.id, r]))
    return draft.ids.flatMap((id) => {
      const r = byId.get(id)
      return r ? [r] : []
    })
  }, [draft, visible])

  // ── Drawing ────────────────────────────────────────────────────────────────────────────────────────

  const addItems: MenuEntry[] = [
    { id: 'link', label: 'Link', icon: <LinkIcon />, onSelect: () => openComposer('link') },
    { id: 'pdf', label: 'PDF', icon: <FileText />, onSelect: pickPdfs },
    { id: 'note', label: 'Note', icon: <StickyNote />, onSelect: () => openComposer('note') },
  ]

  const tabs: TabItem<ResourceFilter>[] = (['all', 'toRead', 'done'] as const).map((value) => ({
    value,
    label: FILTER_LABELS[value],
    count: counts[value],
  }))

  const total = resources?.length ?? 0

  function list() {
    if (shown.length === 0) {
      return (
        <p className={styles.quiet}>
          {active === 'toRead'
            ? 'You’re all caught up. Nothing is waiting to be read.'
            : 'Nothing is marked done yet.'}{' '}
          <button type="button" className={styles.linkButton} onClick={() => setFilter('all')}>
            Show all
          </button>
        </p>
      )
    }
    return (
      <ResourceSortable
        items={shown}
        aria-label={`${FILTER_LABELS[active]} resources`}
        nameOf={(r) => r.title}
        onReorder={(ids) => void reorder(ids)}
        rowProps={(r) => ({ 'data-resource-id': r.id })}
        renderRow={(r, { handle }) =>
          editingId === r.id ? (
            <ResourceForm
              mode="edit"
              kind={r.kind}
              initial={r}
              onCancel={() => {
                setEditingId(null)
                focusRowMenu(r.id)
              }}
              onSubmit={async (v) => {
                const out = await actions.edit(r.id, {
                  title: v.title,
                  notes: v.notes,
                  ...(r.kind === 'link' ? { url: v.url } : {}),
                })
                if (!out.ok) return out.message
                setEditingId(null)
                announce(`Saved ${out.resource.title}`)
                focusRowMenu(r.id)
                return null
              }}
            />
          ) : (
            <ResourceRow
              resource={r}
              handle={handle}
              flash={reveal?.id === r.id}
              onFlashEnd={() => setReveal((current) => (current?.id === r.id ? null : current))}
              onToggle={(done) => void toggle(r, done)}
              onEdit={() => {
                setComposer(null)
                setEditingId(r.id)
              }}
              onDelete={() => void remove(r)}
              onOpenPdf={() => void actions.open(r)}
              onDownload={() => void actions.download(r)}
            />
          )
        }
      />
    )
  }

  let body
  if (resources === undefined) {
    body = (
      <div className={styles.loading} aria-busy="true">
        <span className="sr-only" role="status">
          Loading resources
        </span>
        <Skeleton width="62%" />
        <Skeleton width="48%" />
        <Skeleton width="55%" />
      </div>
    )
  } else if (total === 0) {
    body = composer !== null ? null : (
      <EmptyState
        size="sm"
        align="start"
        icon={<BookMarked />}
        title="No resources yet"
        description="Keep this course’s links, PDFs and notes in one place, and tick them off as you get through them. You can also drop a PDF anywhere on this panel."
        action={
          <div className={styles.emptyActions}>
            <Button size="sm" iconLeft={<LinkIcon />} onClick={() => openComposer('link')}>
              Add a link
            </Button>
            <Button size="sm" iconLeft={<FileText />} onClick={pickPdfs}>
              Add a PDF
            </Button>
            <Button size="sm" iconLeft={<StickyNote />} onClick={() => openComposer('note')}>
              Write a note
            </Button>
          </div>
        }
      />
    )
  } else {
    body = (
      <Tabs
        label="Show resources"
        size="sm"
        items={tabs}
        value={active}
        onValueChange={(next) => setFilter(next)}
      >
        {() => list()}
      </Tabs>
    )
  }

  return (
    <section
      ref={root}
      className={styles.panel}
      aria-labelledby={headingId}
      aria-busy={resources === undefined || undefined}
      data-testid="resources-panel"
      data-dragging={dragging || undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className={styles.head}>
        <h2 id={headingId} ref={heading} tabIndex={-1} className={styles.title}>
          Resources
        </h2>
        <div className={styles.headActions}>
          {busy ? (
            <span className={styles.saving} role="status">
              Saving PDF…
            </span>
          ) : null}
          <Dropdown
            label="Add a resource"
            align="end"
            open={menuOpen}
            onOpenChange={setMenuOpen}
            items={addItems}
            trigger={(p) => (
              <Button
                {...p}
                data-role="add"
                size="sm"
                iconLeft={<Plus />}
                aria-keyshortcuts="a"
                aria-label="Add a resource"
              >
                Add
                <span className={styles.hint} aria-hidden="true">
                  <Kbd keys="a" size="sm" variant="plain" />
                </span>
              </Button>
            )}
          />
        </div>
      </header>

      {composer !== null ? (
        <ResourceForm
          key={composer}
          mode="add"
          kind={composer}
          onCancel={() => {
            setComposer(null)
            focusAdd()
          }}
          onSubmit={async (v) => {
            const out =
              composer === 'link'
                ? await actions.addLink({ url: v.url, title: v.title })
                : await actions.addNote({ title: v.title, notes: v.notes })
            if (!out.ok) return out.message
            setComposer(null)
            setFilter((f) => (f === 'done' ? 'toRead' : f))
            setReveal({ id: out.resource.id, focus: false, fresh: true })
            announce(`Added ${composer}: ${out.resource.title}`)
            focusAdd()
            return null
          }}
        />
      ) : null}

      {body}

      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept="application/pdf,.pdf"
        tabIndex={-1}
        aria-label="Choose PDF files"
        onChange={onFilesChosen}
      />

      {dragging ? (
        <div className={styles.drop} aria-hidden="true">
          Drop PDFs to add them to this course
        </div>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <Modal
        open={pending !== null}
        onClose={cancelPending}
        title="Space is running low"
        description={pending?.message}
        size="sm"
        phoneLayout="sheet"
        footer={
          <>
            <Button variant="ghost" onClick={cancelPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const go = pending
                setPending(null)
                if (go) void save(go.files, go.earlier)
              }}
            >
              Save anyway
            </Button>
          </>
        }
      >
        <p className={styles.modalNote}>
          PDFs stay on this device, in your browser’s storage. Deleting old PDFs, or other site data,
          makes room.
        </p>
      </Modal>
    </section>
  )
}
