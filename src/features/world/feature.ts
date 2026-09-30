import { Download, Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import { lazy } from 'react'
import type { CommandDef, FeatureManifest, ShortcutDef } from '@/app/registry'

/**
 * My World (Phase 8A): `/world`, the isometric city that grows as work gets finished. The engine is
 * `engine/` (canvas) over `@/logic/world` (pure layout); the page is `WorldPage`. `g w` (built in) opens it.
 *
 * On the page: `=` and `-` zoom, `0` fits the whole city, `e` saves it as a PNG. With the canvas focused,
 * the arrow keys pan, and Enter starts stepping through what has been built (the canvas handles those keys
 * itself). The zoom, fit and export commands only show while the page is open.
 */
const group = 'My World'
const scope = 'world' as const

const shortcuts: ShortcutDef[] = [
  { id: 'world.zoomIn', keys: '=', description: 'Zoom in', group, scope },
  { id: 'world.zoomOut', keys: '-', description: 'Zoom out', group, scope },
  { id: 'world.fit', keys: '0', description: 'Fit the whole city in view', group, scope },
  { id: 'world.export', keys: 'e', description: 'Export the city as a PNG', group, scope },
]

const onWorldPage = (): boolean => /^\/world\/?$/.test(window.location.pathname)

const commands: CommandDef[] = [
  {
    id: 'command.world.zoomIn',
    title: 'Zoom in on My World',
    group: 'View',
    icon: ZoomIn,
    keywords: ['city', 'closer', 'bigger', 'magnify'],
    shortcutId: 'world.zoomIn',
    when: onWorldPage,
    run: (c) => c.invoke('world.zoomIn'),
  },
  {
    id: 'command.world.zoomOut',
    title: 'Zoom out of My World',
    group: 'View',
    icon: ZoomOut,
    keywords: ['city', 'further', 'smaller'],
    shortcutId: 'world.zoomOut',
    when: onWorldPage,
    run: (c) => c.invoke('world.zoomOut'),
  },
  {
    id: 'command.world.fit',
    title: 'Fit My World to the view',
    group: 'View',
    icon: Maximize,
    keywords: ['city', 'reset', 'centre', 'center', 'whole'],
    shortcutId: 'world.fit',
    when: onWorldPage,
    run: (c) => c.invoke('world.fit'),
  },
  {
    id: 'command.world.export',
    title: 'Export My World as PNG',
    group: 'View',
    icon: Download,
    keywords: ['city', 'image', 'picture', 'share', 'download', 'save'],
    shortcutId: 'world.export',
    when: onWorldPage,
    run: (c) => c.invoke('world.export'),
  },
]

const manifest: FeatureManifest = {
  id: 'world',
  routes: { world: lazy(() => import('./WorldPage')) },
  shortcuts,
  commands,
}

export default manifest
