import { BookmarkPlus, RotateCcw, Save } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { recordError } from '@/app/reportError'
import { navigate, setQuery } from '@/app/router'
import { createSavedView, DEFAULT_VIEW_ICON, updateSavedView } from '@/db/repos/views'
import type { SavedView } from '@/db/types'
import type { TaskListView } from '@/logic/taskListView'
import type { TaskListId } from '@/logic/taskLists'
import {
  resetViewQuery,
  saveViewNote,
  suggestViewName,
  viewToSave,
  type TaskLayout,
} from '@/logic/taskViews'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'
import { PAGE_EMOJI } from '@/ui/PageHeader'
import { Popover } from '@/ui/Popover'
import { useToast } from '@/ui/Toast'
import styles from './SavedViewsActions.module.css'

/** A short row of icons to pick from; the names come from the shared emoji list. */
const ICON_CHOICES = ['📌', '🎯', '📚', '🔥', '⚡', '🧠', '⭐', '🗓️']
const ICONS = ICON_CHOICES.map((char) => ({
  char,
  name: PAGE_EMOJI.find((e) => e.char === char)?.name ?? char,
}))

interface SaveFormProps {
  list: TaskListId
  view: TaskListView
  layout: TaskLayout
  courseLabels: Readonly<Record<string, string>>
  close: () => void
}

function SaveForm({ list, view, layout, courseLabels, close }: SaveFormProps) {
  const toast = useToast()
  const [name, setName] = useState(() => suggestViewName(view, courseLabels))
  const [icon, setIcon] = useState(DEFAULT_VIEW_ICON)
  const [busy, setBusy] = useState(false)
  const empty = name.trim() === ''

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (empty || busy) return
    setBusy(true)
    try {
      const toStore = viewToSave(list, view)
      const saved = await createSavedView({
        name,
        icon,
        layout,
        filter: toStore.filter,
        sort: toStore.sort,
        groupBy: toStore.groupBy,
      })
      close()
      navigate('taskView', { viewId: saved.id })
      toast.success(`Saved view “${saved.name}”`, {
        description: 'It is in the sidebar under Tasks.',
      })
    } catch (error) {
      recordError(error, 'createSavedView')
      setBusy(false)
      toast.error('Couldn’t save the view', { description: 'Nothing was saved. Try again.' })
    }
  }

  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)}>
      <h3 className={styles.title}>Save this view</h3>
      <Input
        label="Name"
        value={name}
        maxLength={60}
        data-autofocus=""
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div role="group" aria-label="Icon" className={styles.icons}>
        {ICONS.map((choice) => (
          <button
            key={choice.char}
            type="button"
            className={styles.icon}
            aria-label={choice.name}
            aria-pressed={icon === choice.char}
            onClick={() => setIcon(choice.char)}
          >
            <span aria-hidden="true">{choice.char}</span>
          </button>
        ))}
      </div>
      <p className={styles.summary}>{saveViewNote(list)}</p>
      <div className={styles.footer}>
        <Button variant="ghost" size="sm" onClick={close}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="submit" disabled={empty} loading={busy}>
          Save view
        </Button>
      </div>
    </form>
  )
}

export interface SaveViewButtonProps {
  list: TaskListId
  view: TaskListView
  layout: TaskLayout
  courseLabels: Readonly<Record<string, string>>
  /** Controlled, so the `v s` shortcut and the palette command can open it. */
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** "Save view": the filter bar's way to keep the current layout, sort and filters under a name. */
export function SaveViewButton({
  list,
  view,
  layout,
  courseLabels,
  open,
  onOpenChange,
}: SaveViewButtonProps) {
  return (
    <Popover
      label="Save view"
      side="bottom"
      align="end"
      open={open}
      onOpenChange={onOpenChange}
      trigger={(p) => (
        <Button {...p} variant="ghost" size="sm" iconLeft={<BookmarkPlus />}>
          Save view
        </Button>
      )}
    >
      {({ close }) => (
        <SaveForm
          list={list}
          view={view}
          layout={layout}
          courseLabels={courseLabels}
          close={close}
        />
      )}
    </Popover>
  )
}

export interface SavedViewActionsProps {
  saved: SavedView
  view: TaskListView
  layout: TaskLayout
}

/** On a saved view with edits not yet saved: put the stored view back, or store the edits. */
export function SavedViewActions({ saved, view, layout }: SavedViewActionsProps) {
  const toast = useToast()

  function update() {
    updateSavedView(saved.id, {
      layout,
      filter: view.filter,
      sort: view.sort,
      groupBy: view.groupBy,
    })
      .then((result) => {
        if (!result) return
        toast.show({
          title: `Updated view “${saved.name}”`,
          undo: async () => {
            await result.undo()
          },
        })
      })
      .catch((error: unknown) => {
        recordError(error, 'updateSavedView')
        toast.error('Couldn’t update the view', { description: 'Nothing was changed. Try again.' })
      })
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        iconLeft={<RotateCcw />}
        onClick={() => setQuery(resetViewQuery())}
      >
        Reset
      </Button>
      <Button variant="secondary" size="sm" iconLeft={<Save />} onClick={update}>
        Update view
      </Button>
    </>
  )
}
