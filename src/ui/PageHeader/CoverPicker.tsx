import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '../Button'
import { Input } from '../Input'
import { parseCoverUrl } from './coverUrl'
import { COVER_PRESETS, COVER_PRESET_LABELS } from './presets'
import type { PageCover } from './presets'
import styles from './PageHeader.module.css'

export interface CoverPickerProps {
  cover: PageCover | null
  onPick: (cover: PageCover) => void
  /** Shows "Upload image". The app stores the file and then sets an image cover. */
  onUpload?: (file: File) => void
  /** Shows an "Image link" field. Off by default: the production CSP only allows local images. */
  allowLink?: boolean
  onRemove?: () => void
}

const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/avif'

/** Cover picker body: eight gradient swatches, optional upload and link. Lives inside a Popover. */
export function CoverPicker({
  cover,
  onPick,
  onUpload,
  allowLink = false,
  onRemove,
}: CoverPickerProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [link, setLink] = useState(cover?.kind === 'image' ? cover.url : '')
  const [error, setError] = useState<string | null>(null)
  const selected = cover?.kind === 'gradient' ? cover.preset : null

  const submitLink = (e: FormEvent) => {
    e.preventDefault()
    const url = parseCoverUrl(link)
    if (!url) {
      setError('Paste a link that starts with https://')
      return
    }
    setError(null)
    onPick({ kind: 'image', url, posY: cover?.kind === 'image' ? cover.posY : undefined })
  }

  const chooseFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onUpload?.(file)
  }

  return (
    <div className={styles.coverPicker}>
      <div role="group" aria-label="Gradient covers" className={styles.swatches}>
        {COVER_PRESETS.map((id, i) => (
          <button
            key={id}
            type="button"
            data-preset={id}
            data-autofocus={selected === id || (selected === null && i === 0) ? '' : undefined}
            className={styles.swatch}
            aria-label={COVER_PRESET_LABELS[id]}
            aria-pressed={selected === id}
            onClick={() => onPick({ kind: 'gradient', preset: id })}
          />
        ))}
      </div>

      {onUpload ? (
        <>
          <input
            ref={fileInput}
            type="file"
            accept={IMAGE_TYPES}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={chooseFile}
          />
          <Button size="sm" iconLeft={<Upload />} onClick={() => fileInput.current?.click()}>
            Upload image
          </Button>
        </>
      ) : null}

      {allowLink ? (
        <form className={styles.linkForm} onSubmit={submitLink} noValidate>
          <Input
            label="Image link"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://…"
            value={link}
            error={error}
            onChange={(e) => {
              setLink(e.target.value)
              setError(null)
            }}
            trailing={
              <Button type="submit" size="sm" variant="primary">
                Apply
              </Button>
            }
          />
        </form>
      ) : null}

      {onRemove ? (
        <Button variant="ghost" size="sm" className={styles.removeButton} onClick={onRemove}>
          Remove cover
        </Button>
      ) : null}
    </div>
  )
}
