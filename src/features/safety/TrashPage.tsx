/**
 * `/trash` (BRIEF §5.11): everything deleted in the last 30 days, grouped by type, with Restore (and Undo),
 * Delete forever (asks first) and Empty trash (typed confirmation). Search filters by title, type and what
 * came along. Each state has its own screen: loading rows, an empty Trash, no matches, and a failed read.
 * The keyboard: `j`/`k` move, `r` restores, `Mod+Backspace` deletes forever, `Shift+E` empties, `f` searches.
 */
import { Search, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useNow } from '@/app/hooks/useNow'
import { setQuery, useQuery } from '@/app/router'
import { useShortcutHandler, useShortcutScope } from '@/app/shortcuts'
import { groupTrash, matchesQuery, restoreNote, type TrashEntry } from '@/logic/trashList'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'
import { Kbd } from '@/ui/Kbd'
import { useToast } from '@/ui/Toast'
import { deleteForever, emptyTheTrash, restoreFromTrashPage } from './actions'
import { useTrash } from './queries'
import { DeleteForeverDialog, EmptyTrashDialog } from './TrashDialogs'
import { TrashRow, restoreButtonId } from './TrashRow'
import { TrashEmpty, TrashError, TrashNoMatches, TrashSkeleton } from './TrashStates'
import styles from './TrashPage.module.css'

/** Where focus goes when the item it was on has left the list. */
type Landing = { kind: 'row'; id: string } | { kind: 'heading' } | { kind: 'search' }

function Heading({
  children,
  headingRef,
}: {
  children?: ReactNode
  headingRef?: Ref<HTMLHeadingElement>
}) {
  return (
    <header className={styles.header}>
      <div className={styles.headText}>
        {/* tabIndex -1: after the last item is restored or deleted, focus lands here instead of on <body>. */}
        <h1 ref={headingRef} tabIndex={-1} className={styles.heading}>
          Trash
        </h1>
        <p className={styles.lead}>
          Deleted items stay here for 30 days, then they’re gone for good.
        </p>
      </div>
      {children}
    </header>
  )
}

function TrashScreen() {
  const entries = useTrash()
  const now = useNow('minute')
  const toast = useToast()
  const query = useQuery()
  const searchField = useRef<HTMLInputElement>(null)

  const [search, setSearch] = useState('')
  // The row the keyboard is on: its id, and where it was, so that after it is restored or deleted the row
  // that took its place is the current one (like the task lists). `null` until a key or focus picks one.
  const [cursor, setCursor] = useState<{ id: string; index: number } | null>(null)
  const [deleting, setDeleting] = useState<TrashEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // Whether the Trash was emptied by something done here, so a screen reader is told (politely) it is empty.
  const [emptied, setEmptied] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  // Entries being restored right now: a second `r` (or click) on the same one must not run it twice.
  const restoring = useRef(new Set<string>())

  const visible = useMemo(
    () => (entries ?? []).filter((e) => matchesQuery(e, search)),
    [entries, search],
  )
  const groups = useMemo(() => groupTrash(visible), [visible])
  const order = useMemo(() => groups.flatMap((g) => g.entries), [groups])
  const current = useMemo(() => {
    if (cursor === null) return null
    return (
      order.find((e) => e.id === cursor.id) ??
      order[Math.min(cursor.index, order.length - 1)] ??
      null
    )
  }, [cursor, order])
  const total = entries?.length ?? 0
  // The Empty trash dialog lives in the URL (`?do=empty`), so the palette and a link can open it. It only
  // opens on a Trash that has something in it: there is nothing to confirm otherwise.
  const emptyOpen = query.do === 'empty' && entries !== undefined && total > 0
  const staleEmptyLink = query.do === 'empty' && entries !== undefined && total === 0
  useEffect(() => {
    if (staleEmptyLink) setQuery({ do: undefined })
  }, [staleEmptyLink])

  // Where focus goes once an item has left the list (its button is about to disappear). It waits for the
  // dialog that asked (Delete forever, Empty trash) to close, or the dialog would hand focus back to <body>.
  const landing = useRef<Landing | null>(null)
  const [, nudge] = useState(0)
  const land = useCallback((next: Landing) => {
    landing.current = next
    nudge((n) => n + 1)
  }, [])
  useEffect(() => {
    const target = landing.current
    if (target === null || deleting !== null || emptyOpen) return
    landing.current = null
    if (target.kind === 'heading') heading.current?.focus()
    else if (target.kind === 'search') searchField.current?.focus()
    else {
      document
        .querySelector<HTMLElement>(`[data-trash-id="${target.id}"] button:not(:disabled)`)
        ?.focus()
    }
  })

  /** Sends focus to the row that takes over from `entry` (and anything restored with it), or to a place that still exists. */
  const landAfter = useCallback(
    (entry: TrashEntry, alsoGone: readonly string[] = []) => {
      const left = order.filter((e) => e.id !== entry.id && !alsoGone.includes(e.id))
      const at = order.findIndex((e) => e.id === entry.id)
      const next = order.slice(at + 1).find((e) => left.includes(e)) ?? left.at(-1)
      if (next) land({ kind: 'row', id: next.id })
      else land(total - 1 - alsoGone.length <= 0 ? { kind: 'heading' } : { kind: 'search' })
    },
    [order, total, land],
  )

  const restore = useCallback(
    async (entry: TrashEntry) => {
      if (restoring.current.has(entry.id)) return
      restoring.current.add(entry.id)
      try {
        const out = await restoreFromTrashPage(entry.id)
        // Already restored (a second key press, another tab): the list is about to say so itself.
        if (!out.ok && out.reason === 'missing') return
        if (!out.ok) {
          toast.error('Couldn’t restore it', { description: out.message })
          return
        }
        const note = restoreNote(out.alsoRestored, out.detached)
        toast.success(`Restored “${entry.title}”`, {
          ...(note ? { description: note } : {}),
          undo: out.undo,
        })
        setEmptied(true)
        landAfter(
          entry,
          out.alsoRestored.map((i) => i.id),
        )
      } finally {
        restoring.current.delete(entry.id)
      }
    },
    [toast, landAfter],
  )

  function askDelete(entry: TrashEntry) {
    setFailure(null)
    setDeleting(entry)
  }

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    setFailure(null)
    const out = await deleteForever(deleting.id)
    setBusy(false)
    if (!out.ok) {
      setFailure(out.message)
      return
    }
    toast.success(`Deleted “${deleting.title}” forever`)
    setEmptied(true)
    landAfter(deleting)
    setDeleting(null)
  }

  function openEmpty() {
    setFailure(null)
    setQuery({ do: 'empty' })
  }
  const closeEmpty = () => setQuery({ do: undefined })

  async function confirmEmpty() {
    setBusy(true)
    setFailure(null)
    const out = await emptyTheTrash()
    setBusy(false)
    if (!out.ok) {
      setFailure(out.message)
      return
    }
    toast.success(
      `Emptied the Trash · ${out.count.toLocaleString('en-US')} ${out.count === 1 ? 'item' : 'items'} deleted`,
    )
    setEmptied(true)
    land({ kind: 'heading' })
    closeEmpty()
  }

  const move = useCallback(
    (delta: 1 | -1) => {
      if (order.length === 0) return
      const at = current
        ? order.findIndex((e) => e.id === current.id)
        : delta === 1
          ? -1
          : order.length
      const index = Math.min(order.length - 1, Math.max(0, at + delta))
      const next = order[index]
      if (!next) return
      setCursor({ id: next.id, index })
      document.getElementById(restoreButtonId(next.id))?.focus()
    },
    [order, current],
  )
  const focusRow = useCallback(
    (id: string) => {
      const index = order.findIndex((e) => e.id === id)
      if (index !== -1) setCursor({ id, index })
    },
    [order],
  )

  useShortcutScope('trash')
  useShortcutHandler('trash.next', () => move(1))
  useShortcutHandler('trash.prev', () => move(-1))
  useShortcutHandler('trash.restore', () => current && void restore(current), current !== null)
  useShortcutHandler('trash.delete', () => current && askDelete(current), current !== null)
  useShortcutHandler('trash.empty', openEmpty, total > 0)
  useShortcutHandler('trash.search', () => searchField.current?.focus())

  return (
    <div className={styles.root}>
      <p className="sr-only" role="status">
        {emptied && total === 0 ? 'The Trash is empty.' : ''}
      </p>
      <Heading headingRef={heading}>
        {total > 0 ? (
          <div className={styles.toolbar}>
            <Input
              ref={searchField}
              className={styles.search}
              type="search"
              aria-label="Search the Trash"
              placeholder="Search deleted items"
              leadingIcon={<Search />}
              trailing={<Kbd keys="f" size="sm" variant="plain" />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && search !== '') {
                  e.preventDefault()
                  setSearch('')
                }
              }}
              autoComplete="off"
              spellCheck={false}
            />
            <Button variant="danger" iconLeft={<Trash2 />} onClick={openEmpty}>
              Empty trash
            </Button>
          </div>
        ) : null}
      </Heading>

      {entries === undefined ? (
        <TrashSkeleton />
      ) : total === 0 ? (
        <TrashEmpty />
      ) : groups.length === 0 ? (
        <TrashNoMatches query={search} onClear={() => setSearch('')} />
      ) : (
        <div className={styles.groups}>
          {groups.map((group) => (
            <section
              key={group.table}
              className={styles.group}
              aria-labelledby={`trash-${group.table}`}
            >
              {/* Read as "Tasks, 3 items"; drawn as the label and a quiet number. */}
              <h2
                id={`trash-${group.table}`}
                className={styles.groupTitle}
                aria-label={`${group.label}, ${group.entries.length} ${group.entries.length === 1 ? 'item' : 'items'}`}
              >
                {group.label}
                <span className={styles.groupCount}>{group.entries.length}</span>
              </h2>
              <ul className={styles.list}>
                {group.entries.map((entry) => (
                  <TrashRow
                    key={entry.id}
                    entry={entry}
                    now={now}
                    current={current?.id === entry.id}
                    onFocusRow={focusRow}
                    onRestore={(e) => void restore(e)}
                    onDelete={askDelete}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <DeleteForeverDialog
        entry={deleting}
        busy={busy}
        error={failure}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
      <EmptyTrashDialog
        open={emptyOpen}
        count={total}
        busy={busy}
        error={failure}
        onCancel={closeEmpty}
        onConfirm={() => void confirmEmpty()}
      />
    </div>
  )
}

export default function TrashPage() {
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <div className={styles.root}>
          <Heading />
          <TrashError onRetry={reset} />
        </div>
      )}
    >
      <TrashScreen />
    </ErrorBoundary>
  )
}
