import { FileText, Link as LinkIcon, StickyNote } from 'lucide-react'
import { lazy } from 'react'
import type { FeatureManifest, SearchProvider } from '@/app/registry'
import { resourceCommands } from './commands'
import { resourceShortcuts } from './shortcuts'

// The panel, its drag and drop code and its forms load with the course page's slot, not with the app.
const ResourcesPanel = lazy(() =>
  import('./ResourcesPanel').then((m) => ({ default: m.ResourcesPanel })),
)

const KIND_ICON = { link: LinkIcon, pdf: FileText, note: StickyNote } as const
const KIND_WORD = { link: 'Link', pdf: 'PDF', note: 'Note' } as const

/**
 * Palette search over resource titles ("mdn", "study guide"). Choosing one opens its course page scrolled to
 * the Resources panel with that row in view (`?panel=resources&resource=<id>`, which the panel answers).
 */
const resourceSearch: SearchProvider = {
  id: 'resources',
  group: 'Resources',
  async search(query, limit) {
    const { searchResources } = await import('./queries')
    const hits = await searchResources(query, limit)
    return hits.map((hit) => ({
      id: `resource:${hit.resource.id}`,
      title: hit.resource.title,
      subtitle: `${KIND_WORD[hit.resource.kind]} · ${hit.course}`,
      icon: KIND_ICON[hit.resource.kind],
      run: (c) =>
        c.navigate(
          'course',
          { goalId: hit.goalId, courseId: hit.courseId },
          { query: { panel: 'resources', resource: hit.resource.id } },
        ),
    }))
  },
}

/**
 * Resources (Phase 11f, BRIEF §5.11): a library per course. Links open in a new tab, PDFs are kept in
 * IndexedDB (`files`) and open through an object URL, notes are plain text; each is to read or done, can be
 * edited, deleted to the Trash with Undo, and reordered by dragging or from the keyboard.
 *
 * Slot: `course.panels` (order 30). Search: "Resources". Key: `a` on a course page. Palette: three "Add …"
 * commands on a course page.
 */
const manifest: FeatureManifest = {
  id: 'resources',
  shortcuts: resourceShortcuts,
  commands: resourceCommands,
  search: [resourceSearch],
  slots: [{ slot: 'course.panels', id: 'resources.panel', order: 30, component: ResourcesPanel }],
}

export default manifest
