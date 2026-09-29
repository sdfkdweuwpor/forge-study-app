import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { recordError } from '@/app/reportError'
import { Link, navigate, useRoute } from '@/app/router'
import { useSavedViews } from '@/db/hooks/useSavedViews'
import { deleteSavedView, renameSavedView } from '@/db/repos/views'
import type { SavedView } from '@/db/types'
import { Dropdown, type MenuEntry } from '@/ui/Dropdown'
import { IconButton } from '@/ui/IconButton'
import { useToast } from '@/ui/Toast'
import styles from './SavedViewsNav.module.css'

interface RenameFieldProps {
  view: SavedView
  onDone: () => void
}

/** The name, edited where it stands: Enter saves, Esc puts the old name back, leaving saves. */
function RenameField({ view, onDone }: RenameFieldProps) {
  const toast = useToast()
  const [draft, setDraft] = useState(view.name)
  const input = useRef<HTMLInputElement | null>(null)
  // Enter and Esc end editing themselves; the blur that follows must not save a second time.
  const finished = useRef(false)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  function commit() {
    if (finished.current) return
    finished.current = true
    const next = draft.trim()
    onDone()
    if (next === '' || next === view.name) return
    renameSavedView(view.id, next).catch((error: unknown) => {
      recordError(error, 'renameSavedView')
      toast.error('Couldn’t rename the view', { description: 'Nothing was changed. Try again.' })
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      finished.current = true
      onDone()
    }
  }

  return (
    <input
      ref={input}
      className={styles.rename}
      aria-label="View name"
      maxLength={60}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={commit}
    />
  )
}

function SavedViewRow({ view, active }: { view: SavedView; active: boolean }) {
  const toast = useToast()
  const [renaming, setRenaming] = useState(false)

  function remove() {
    deleteSavedView(view.id)
      .then((result) => {
        if (!result) return
        // Deleting the view you are looking at would leave a "missing view" page: go to All tasks.
        if (active) navigate('tasks', { list: 'all' }, { replace: true })
        toast.show({
          title: `Deleted view “${view.name}”`,
          undo: async () => {
            await result.undo()
          },
        })
      })
      .catch((error: unknown) => {
        recordError(error, 'deleteSavedView')
        toast.error('Couldn’t delete the view', { description: 'Nothing was changed. Try again.' })
      })
  }

  const items: MenuEntry[] = [
    { id: 'rename', label: 'Rename', icon: <Pencil />, onSelect: () => setRenaming(true) },
    { type: 'separator', id: 'sep-delete' },
    { id: 'delete', label: 'Delete view', icon: <Trash2 />, danger: true, onSelect: remove },
  ]

  return (
    <li className={styles.item} data-active={active || undefined}>
      {renaming ? (
        <RenameField view={view} onDone={() => setRenaming(false)} />
      ) : (
        <>
          <Link
            to="taskView"
            params={{ viewId: view.id }}
            className={styles.link}
            aria-current={active ? 'page' : undefined}
          >
            <span className={styles.icon} aria-hidden="true">
              {view.icon}
            </span>
            <span className={styles.label}>{view.name}</span>
          </Link>
          <Dropdown
            label={`Actions for ${view.name}`}
            side="bottom"
            align="end"
            items={items}
            trigger={(p) => (
              <IconButton
                {...p}
                className={styles.more}
                label={`Actions for ${view.name}`}
                icon={<MoreHorizontal />}
                size="xs"
                tooltip={false}
              />
            )}
          />
        </>
      )}
    </li>
  )
}

/**
 * Saved views, listed under the Tasks lists in the sidebar (slot `sidebar.nav.tasks`). Click one to open
 * it; the … menu renames it in place or deletes it (with Undo). Nothing renders until one exists.
 */
export function SavedViewsNav() {
  const views = useSavedViews()
  const route = useRoute()
  if (!views || views.length === 0) return null
  const activeId = route.name === 'taskView' ? route.params.viewId : null
  return (
    <>
      <li className={styles.heading} aria-hidden="true">
        Views
      </li>
      {views.map((view) => (
        <SavedViewRow key={view.id} view={view} active={view.id === activeId} />
      ))}
    </>
  )
}
