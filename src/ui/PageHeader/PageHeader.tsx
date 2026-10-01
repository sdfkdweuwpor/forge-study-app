import { useState, type ReactNode } from 'react'
import { Image as ImageIcon, Smile, X } from 'lucide-react'
import { Button } from '../Button'
import { Popover } from '../Popover'
import { Skeleton } from '../Skeleton'
import { cx } from '../internal/cx'
import type { ForceProps } from '../internal/force'
import { CoverPicker } from './CoverPicker'
import { EmojiGrid } from './EmojiGrid'
import { TitleField } from './TitleField'
import { isCoverPresetId, type PageCover } from './presets'
import styles from './PageHeader.module.css'

export { COVER_PRESETS, COVER_PRESET_LABELS, isCoverPresetId } from './presets'
export type { CoverPresetId, PageCover } from './presets'
export { PAGE_EMOJI } from './emoji'
export { CoverPicker } from './CoverPicker'
export type { CoverPickerProps } from './CoverPicker'
export { EmojiGrid } from './EmojiGrid'

export interface PageHeaderProps extends ForceProps {
  title: string
  /** Makes the title editable in place. Enter or blur commits, Esc reverts. */
  onTitleChange?: (title: string) => void
  titlePlaceholder?: string
  /** An emoji, or null / omitted for none. */
  icon?: string | null
  /** Makes the icon changeable (a picker opens on click). `null` means removed. */
  onIconChange?: (icon: string | null) => void
  cover?: PageCover | null
  /** Makes the cover changeable and removable. */
  onCoverChange?: (cover: PageCover | null) => void
  /** Adds "Upload image" to the cover picker. The app stores the file, then sets an image cover. */
  onUploadCover?: (file: File) => void
  /** Adds an "Image link" field to the cover picker (the app's CSP must allow the host). */
  allowCoverLink?: boolean
  /** One quiet line under the title. */
  subtitle?: ReactNode
  /** Row for chips, dates and counts under the subtitle. */
  meta?: ReactNode
  /** Skeleton while the page loads. */
  loading?: boolean
  className?: string
}

type PickerKey = 'icon' | 'add-icon' | 'cover' | 'add-cover'

/**
 * Notion-style page header: optional cover (200px, 120px on phones), a 64px emoji icon that
 * overlaps the cover's bottom edge, an inline-editable 40px title, and subtitle / meta slots.
 * Edit controls appear on hover and keyboard focus (always on touch screens) and exist only for
 * the parts that have an `on…Change` handler, so omit them for a read-only page.
 */
export function PageHeader({
  title,
  onTitleChange,
  titlePlaceholder = 'Untitled',
  icon = null,
  onIconChange,
  cover = null,
  onCoverChange,
  onUploadCover,
  allowCoverLink = false,
  subtitle,
  meta,
  loading = false,
  className,
  'data-force': force,
}: PageHeaderProps) {
  const [openPicker, setOpenPicker] = useState<PickerKey | null>(null)
  const watch = (key: PickerKey) => (open: boolean) =>
    setOpenPicker((current) => (open ? key : current === key ? null : current))

  if (loading) return <HeaderSkeleton className={className} />

  const hasCover = cover !== null
  const hasIcon = icon !== null && icon !== ''
  const canAddIcon = !hasIcon && onIconChange !== undefined
  const canAddCover = !hasCover && onCoverChange !== undefined

  return (
    <header
      className={cx(styles.root, className)}
      data-has-cover={hasCover || undefined}
      data-has-icon={hasIcon || undefined}
      data-force={force}
    >
      {cover ? (
        <div className={styles.coverWrap} data-open={openPicker === 'cover' || undefined}>
          <CoverArt cover={cover} />
          {onCoverChange ? (
            <div className={styles.coverActions}>
              <CoverControl
                cover={cover}
                onChange={onCoverChange}
                onOpenChange={watch('cover')}
                onUpload={onUploadCover}
                allowLink={allowCoverLink}
                trigger="change"
              />
              <Button
                size="sm"
                iconLeft={<X />}
                aria-label="Remove cover"
                onClick={() => onCoverChange(null)}
              >
                Remove
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={styles.content}>
        {hasIcon ? (
          <div className={styles.iconRow}>
            {onIconChange ? (
              <IconControl icon={icon} onChange={onIconChange} onOpenChange={watch('icon')} />
            ) : (
              <span className={styles.iconGlyph} role="img" aria-label="Page icon">
                {icon}
              </span>
            )}
          </div>
        ) : null}

        {canAddIcon || canAddCover ? (
          <div
            className={styles.addRow}
            data-open={openPicker === 'add-icon' || openPicker === 'add-cover' || undefined}
          >
            {canAddIcon ? (
              <IconControl icon={null} onChange={onIconChange} onOpenChange={watch('add-icon')} />
            ) : null}
            {canAddCover ? (
              <CoverControl
                cover={null}
                onChange={onCoverChange}
                onOpenChange={watch('add-cover')}
                onUpload={onUploadCover}
                allowLink={allowCoverLink}
                trigger="add"
              />
            ) : null}
          </div>
        ) : null}

        {onTitleChange ? (
          <TitleField title={title} placeholder={titlePlaceholder} onCommit={onTitleChange} />
        ) : (
          <h1
            className={cx(styles.titleHeading, styles.titleStatic)}
            data-empty={!title || undefined}
          >
            {title || titlePlaceholder}
          </h1>
        )}

        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        {meta ? <div className={styles.meta}>{meta}</div> : null}
      </div>
    </header>
  )
}

function CoverArt({ cover }: { cover: PageCover }) {
  if (cover.kind === 'gradient') {
    const preset = isCoverPresetId(cover.preset) ? cover.preset : 'stone'
    return <div className={styles.cover} data-preset={preset} aria-hidden="true" />
  }
  return <CoverImage key={cover.url} url={cover.url} posY={cover.posY ?? 50} />
}

function CoverImage({ url, posY }: { url: string; posY: number }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  return (
    <div
      className={styles.cover}
      data-status={status}
      aria-hidden={status === 'error' ? undefined : true}
    >
      {status === 'error' ? (
        <p className={styles.coverError} role="status">
          This cover image could not be loaded.
        </p>
      ) : (
        <img
          src={url}
          alt=""
          decoding="async"
          className={styles.coverImage}
          style={{ objectPosition: `50% ${Math.min(100, Math.max(0, posY))}%` }}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
        />
      )}
    </div>
  )
}

interface IconControlProps {
  icon: string | null
  onChange: ((icon: string | null) => void) | undefined
  onOpenChange: (open: boolean) => void
}

function IconControl({ icon, onChange, onOpenChange }: IconControlProps) {
  return (
    <Popover
      label="Choose icon"
      align="start"
      onOpenChange={onOpenChange}
      trigger={(p) =>
        icon ? (
          <button type="button" {...p} className={styles.iconButton} aria-label="Change icon">
            <span className={styles.iconGlyph} aria-hidden="true">
              {icon}
            </span>
          </button>
        ) : (
          <Button {...p} variant="ghost" size="sm" iconLeft={<Smile />}>
            Add icon
          </Button>
        )
      }
    >
      {({ close }) => (
        <EmojiGrid
          current={icon}
          onPick={(emoji) => {
            onChange?.(emoji)
            close()
          }}
          onRemove={
            icon
              ? () => {
                  onChange?.(null)
                  close()
                }
              : undefined
          }
        />
      )}
    </Popover>
  )
}

interface CoverControlProps {
  cover: PageCover | null
  onChange: ((cover: PageCover | null) => void) | undefined
  onOpenChange: (open: boolean) => void
  onUpload: ((file: File) => void) | undefined
  allowLink: boolean
  trigger: 'change' | 'add'
}

function CoverControl({
  cover,
  onChange,
  onOpenChange,
  onUpload,
  allowLink,
  trigger,
}: CoverControlProps) {
  return (
    <Popover
      label="Choose cover"
      align={trigger === 'change' ? 'end' : 'start'}
      onOpenChange={onOpenChange}
      trigger={(p) => (
        <Button
          {...p}
          variant={trigger === 'change' ? 'secondary' : 'ghost'}
          size="sm"
          iconLeft={<ImageIcon />}
        >
          {trigger === 'change' ? 'Change cover' : 'Add cover'}
        </Button>
      )}
    >
      {({ close }) => (
        <CoverPicker
          cover={cover}
          allowLink={allowLink}
          onUpload={
            onUpload
              ? (file) => {
                  onUpload(file)
                  close()
                }
              : undefined
          }
          onPick={(next) => {
            onChange?.(next)
            close()
          }}
          onRemove={
            cover
              ? () => {
                  onChange?.(null)
                  close()
                }
              : undefined
          }
        />
      )}
    </Popover>
  )
}

function HeaderSkeleton({ className }: { className?: string }) {
  return (
    <header className={cx(styles.root, className)} aria-busy="true">
      <div className={styles.content}>
        <span className="sr-only" role="status">
          Loading page
        </span>
        <div className={styles.skeleton} aria-hidden="true">
          <Skeleton variant="block" className={styles.skeletonTitle} />
          <Skeleton variant="block" className={styles.skeletonLine} />
        </div>
      </div>
    </header>
  )
}
