import { useCallback, useId, useMemo, useState } from 'react'
import { Keyboard, Search } from 'lucide-react'
import { isMac } from '@/lib/platform'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Input } from '@/ui/Input'
import { Kbd, formatShortcut } from '@/ui/Kbd'
import { Modal } from '@/ui/Modal'
import { buildShortcutGroups, countRows } from '../palette/shortcutList'
import { useOpenOverlays, useOverlays } from '../providers/OverlayProvider'
import { useRegistry } from '../registry/RegistryContext'
import { useShortcutScope } from './useShortcut'
import styles from './ShortcutSheet.module.css'

/**
 * The "?" sheet: every shortcut registered by the shell and the features, grouped by their `group`,
 * drawn with Kbd, searchable. It is built from the registry, so it can never drift from what works.
 * Mounted once by the app shell; the overlay state lives in OverlayProvider ('shortcuts').
 */
export function ShortcutSheet() {
  const overlays = useOverlays()
  const open = useOpenOverlays().includes('shortcuts')
  const { shortcuts } = useRegistry()
  const searchId = useId()
  // While open, this is a dialog: single-key shortcuts must not fire behind it.
  useShortcutScope('modal', open)

  const [query, setQuery] = useState('')
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setQuery('')
  }

  const mac = isMac()
  /** "Ctrl K", "⌘ K": what is printed on the keycaps, so searching for it works. */
  const keysText = useCallback(
    (keys: string) => formatShortcut(keys, mac).map((chord) => chord.join(' ')).join(' then '),
    [mac],
  )
  const groups = useMemo(
    () => buildShortcutGroups(shortcuts, query, keysText),
    [shortcuts, query, keysText],
  )
  const total = countRows(groups)
  const searching = query.trim() !== ''

  return (
    <Modal
      open={open}
      onClose={() => overlays.close('shortcuts')}
      title="Keyboard shortcuts"
      description="Everything the keyboard can do. Sequences like G then T are pressed one key after the other."
      size="lg"
    >
      <div className={styles.sheet}>
        <Input
          id={searchId}
          type="search"
          size="md"
          aria-label="Filter shortcuts"
          placeholder="Filter shortcuts"
          leadingIcon={<Search />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          data-autofocus=""
        />

        <div className="sr-only" role="status" aria-live="polite">
          {total === 0 ? 'No matching shortcuts' : `${total} ${total === 1 ? 'shortcut' : 'shortcuts'}`}
        </div>

        {total === 0 ? (
          <EmptyState
            size="sm"
            icon={searching ? <Search /> : <Keyboard />}
            title={searching ? 'No matching shortcuts' : 'No shortcuts yet'}
            description={
              searching
                ? 'Try a key, an action or a page name.'
                : 'Shortcuts appear here as soon as features register them.'
            }
            action={
              searching ? (
                <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
                  Clear filter
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className={styles.columns}>
            {groups.map((group) => {
              const headingId = `${searchId}-${group.id}`
              return (
                <section key={group.id} className={styles.group} aria-labelledby={headingId}>
                  <h3 id={headingId} className={styles.heading}>
                    {group.heading}
                  </h3>
                  <dl className={styles.list}>
                    {group.rows.map((row) => (
                      <div key={row.id} className={styles.row}>
                        <dt className={styles.description}>
                          {row.description}
                          {row.scopeLabel ? (
                            <span className={styles.scope}>{row.scopeLabel}</span>
                          ) : null}
                        </dt>
                        <dd className={styles.keys}>
                          <Kbd keys={row.keys} size="sm" />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
