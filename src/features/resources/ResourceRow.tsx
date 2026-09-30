import {
  Download,
  FileText,
  Link as LinkIcon,
  MoreHorizontal,
  Pencil,
  StickyNote,
  Trash2,
} from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { useSyncOn } from '@/db/hooks/useSyncState'
import { hostLabel, KIND_LABELS, notePreview, safeHref } from '@/logic/resources'
import { formatBytes } from '@/logic/retention'
import { Checkbox } from '@/ui/Checkbox'
import { Dropdown, type MenuEntry } from '@/ui/Dropdown'
import { IconButton } from '@/ui/IconButton'
import type { ResourceView } from './queries'
import styles from './ResourceRow.module.css'

const KIND_ICON = { link: LinkIcon, pdf: FileText, note: StickyNote } as const

/** Why a PDF has no file here: with sync on, because PDFs stay on the device they were added on. */
function MissingFile() {
  const syncOn = useSyncOn()
  return syncOn
    ? "This PDF isn't on this device. PDFs stay on the device they were added on."
    : 'File missing. It wasn’t included in the backup this came from.'
}

export interface ResourceRowProps {
  resource: ResourceView
  /** The drag handle from the sortable list. */
  handle: ReactNode
  /** Draw the soft highlight of "found it" (the palette opened the page here). */
  flash: boolean
  onFlashEnd: () => void
  onToggle: (done: boolean) => void
  onEdit: () => void
  onDelete: () => void
  onOpenPdf: () => void
  onDownload: () => void
}

/**
 * One resource: a checkbox for read / not read, an icon for its kind, the title as the way to open it
 * (a link opens in a new tab, a PDF opens through an object URL, a note unfolds), a quiet line under it
 * (the site, the size, the start of a note), and a menu. A done row is muted, not struck through.
 */
export function ResourceRow({
  resource,
  handle,
  flash,
  onFlashEnd,
  onToggle,
  onEdit,
  onDelete,
  onOpenPdf,
  onDownload,
}: ResourceRowProps) {
  const { kind, title, notes } = resource
  const done = resource.status === 'done'
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()
  const Icon = KIND_ICON[kind]
  const href = kind === 'link' ? safeHref(resource.url) : null

  let titleNode: ReactNode
  if (kind === 'link' && href !== null) {
    titleNode = (
      <a
        className={styles.open}
        data-row-title
        href={href}
        target="_blank"
        rel="noopener noreferrer"
      >
        {title}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    )
  } else if (kind === 'pdf' && !resource.fileMissing) {
    titleNode = (
      <button
        type="button"
        className={styles.open}
        data-row-title
        aria-label={`Open ${title}`}
        onClick={onOpenPdf}
      >
        {title}
      </button>
    )
  } else if (kind === 'note' && notes.trim() !== '') {
    titleNode = (
      <button
        type="button"
        className={styles.open}
        data-row-title
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded((open) => !open)}
      >
        {title}
      </button>
    )
  } else {
    titleNode = <span className={styles.plain}>{title}</span>
  }

  const preview = notePreview(notes, 140, kind === 'note' ? title : undefined)
  const facts: string[] = []
  let warning: ReactNode = null
  if (kind === 'link') {
    if (href !== null) facts.push(hostLabel(href))
    else warning = 'Not a web link, so it can’t be opened.'
  } else if (kind === 'pdf') {
    if (resource.file) facts.push(`PDF · ${formatBytes(resource.file.size)}`)
    else warning = <MissingFile />
  }
  if (kind !== 'note' && preview !== '') facts.push(preview)
  const meta = kind === 'note' ? (expanded ? '' : preview) : facts.join(' · ')

  const menu: MenuEntry[] = [
    { id: 'edit', label: 'Edit', icon: <Pencil />, onSelect: onEdit },
    ...(kind === 'pdf' && !resource.fileMissing
      ? [{ id: 'download', label: 'Download', icon: <Download />, onSelect: onDownload }]
      : []),
    { type: 'separator' },
    { id: 'delete', label: 'Delete', icon: <Trash2 />, danger: true, onSelect: onDelete },
  ]

  return (
    <div
      className={styles.row}
      data-done={done || undefined}
      data-flash={flash || undefined}
      onAnimationEnd={(e) => {
        // Only the row's own highlight, not the checkbox's fill animation bubbling up.
        if (flash && e.target === e.currentTarget) onFlashEnd()
      }}
    >
      <span className={styles.handle}>{handle}</span>
      <Checkbox
        className={styles.check}
        aria-label={`Done: ${title}`}
        checked={done}
        onCheckedChange={onToggle}
      />
      <Icon className={styles.kind} size={16} aria-hidden="true" />
      <div className={styles.main}>
        <p className={styles.title}>
          {titleNode}
          <span className="sr-only">{`, ${KIND_LABELS[kind]}`}</span>
        </p>
        {warning !== null ? (
          <p className={styles.meta} data-warning>
            {warning}
          </p>
        ) : meta !== '' ? (
          <p className={styles.meta}>{meta}</p>
        ) : null}
        {kind === 'note' && notes.trim() !== '' ? (
          <div id={bodyId} className={styles.body} hidden={!expanded}>
            {notes}
          </div>
        ) : null}
      </div>
      <Dropdown
        label={`Actions for ${title}`}
        align="end"
        items={menu}
        trigger={(p) => (
          <IconButton
            {...p}
            className={styles.more}
            label={`Actions for ${title}`}
            icon={<MoreHorizontal />}
            size="xs"
            tooltip={false}
          />
        )}
      />
    </div>
  )
}
