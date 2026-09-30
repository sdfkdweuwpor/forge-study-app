/**
 * `/trash` (BRIEF §5.11): everything deleted in the last 30 days, grouped by type, with Restore (and Undo),
 * Delete forever (asks first) and Empty trash (typed confirmation). Search filters by title, type and what
 * came along. Each state has its own screen: loading rows, an empty Trash, no matches, and a failed read.
 * The keyboard: `j`/`k` move, `r` restores, `Mod+Backspace` deletes forever, `Shift+E` empties, `f` searches.
 */
import { Search, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
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

function Heading({ children }: { children?: React.ReactNode }) {
  return (
    <header className={styles.header}>
      <div className={styles.headText}>
        <h1 className={styles.heading}>Trash</h1>
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
  // The Empty trash dialog lives in the URL (`?do=empty`), so the palette and a link can open it.
  const emptyOpen = query.do === 'empty'

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

  const restore = useCallback(
    async (entry: TrashEntry) => {
      const out = await restoreFromTrashPage(entry.id)
      if (!out.ok) {
        toast.error('Couldn’t restore it', { description: out.message })
        return
      }
      const note = restoreNote(out.alsoRestored, out.detached)
      toast.success(`Restored “${entry.title}”`, {
        ...(note ? { description: note } : {}),
        undo: out.undo,
      })
    },
    [toast],
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
      <Heading>
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
              <h2 id={`trash-${group.table}`} className={styles.groupTitle}>
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
