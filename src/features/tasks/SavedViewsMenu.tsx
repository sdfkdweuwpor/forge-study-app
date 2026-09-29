import { Check, Layers } from 'lucide-react'
import { navigate, useRoute } from '@/app/router'
import { useSavedViews } from '@/db/hooks/useSavedViews'
import { TASK_LISTS } from '@/logic/taskLists'
import { Button } from '@/ui/Button'
import { Dropdown, type MenuEntry } from '@/ui/Dropdown'

/**
 * Lists and saved views in one menu, for phones, where the sidebar is not on screen. It is hidden by
 * CSS from 640 px up, where the sidebar shows the same links.
 */
export function SavedViewsMenu() {
  const views = useSavedViews()
  const route = useRoute()
  const activeList = route.name === 'tasks' ? (route.params.list ?? 'inbox') : null
  const activeView = route.name === 'taskView' ? route.params.viewId : null

  const items: MenuEntry[] = [
    { type: 'label', label: 'Lists' },
    ...TASK_LISTS.map<MenuEntry>((list) => ({
      id: list.id,
      label: list.label,
      icon: activeList === list.id ? <Check /> : undefined,
      onSelect: () => navigate('tasks', { list: list.id }),
    })),
    ...(views && views.length > 0
      ? ([
          { type: 'separator', id: 'sep-views' },
          { type: 'label', label: 'Views' },
          ...views.map<MenuEntry>((view) => ({
            id: `view-${view.id}`,
            label: `${view.icon} ${view.name}`,
            icon: activeView === view.id ? <Check /> : undefined,
            onSelect: () => navigate('taskView', { viewId: view.id }),
          })),
        ] satisfies MenuEntry[])
      : []),
  ]

  return (
    <Dropdown
      label="Lists and views"
      side="bottom"
      align="end"
      items={items}
      trigger={(p) => (
        <Button {...p} variant="ghost" size="sm" iconLeft={<Layers />}>
          Views
        </Button>
      )}
    />
  )
}
