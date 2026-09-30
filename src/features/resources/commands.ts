import { FileText, Link as LinkIcon, StickyNote } from 'lucide-react'
import type { CommandDef } from '@/app/registry'

/** True on a course page, where the resources panel is. */
const onCoursePage = (): boolean =>
  /^\/goals\/[^/]+\/courses\/[^/]+\/?$/.test(window.location.pathname)

/**
 * Palette entries for adding to the course you are on. Each calls a handler the panel binds (see
 * `ResourcesPanel`); the palette offers them only on a course page.
 */
export const resourceCommands: CommandDef[] = [
  {
    id: 'command.resources.addLink',
    title: 'Add a link to this course',
    group: 'Goals',
    icon: LinkIcon,
    keywords: ['resource', 'url', 'website', 'bookmark', 'reading'],
    when: onCoursePage,
    run: (c) => c.invoke('resources.addLink'),
  },
  {
    id: 'command.resources.addPdf',
    title: 'Add a PDF to this course',
    group: 'Goals',
    icon: FileText,
    keywords: ['resource', 'upload', 'file', 'study guide', 'attach'],
    when: onCoursePage,
    run: (c) => c.invoke('resources.addPdf'),
  },
  {
    id: 'command.resources.addNote',
    title: 'Add a note to this course',
    group: 'Goals',
    icon: StickyNote,
    keywords: ['resource', 'write', 'text', 'reading'],
    when: onCoursePage,
    run: (c) => c.invoke('resources.addNote'),
  },
]
