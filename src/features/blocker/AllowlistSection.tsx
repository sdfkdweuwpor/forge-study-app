import { X } from 'lucide-react'
import { useCallback } from 'react'
import { recordError } from '@/app/reportError'
import {
  addAllowException,
  removeBlocklistEntry,
  setBlocklistEntryEnabled,
} from '@/db/repos/blocker'
import type { BlocklistEntry } from '@/db/types'
import { splitPattern } from '@/logic/blocker'
import { IconButton } from '@/ui/IconButton'
import { Skeleton } from '@/ui/Skeleton'
import { Toggle } from '@/ui/Toggle'
import { useToast } from '@/ui/Toast'
import { AddField } from './AddField'
import { addOrExplain } from './addOrExplain'
import { Favicon } from './Favicon'
import { useBlocklist } from './queries'
import { Section } from './Section'
import styles from './List.module.css'

/**
 * Exceptions: a page or channel that stays reachable while its site is blocked, like the one lecture
 * video you need or a study channel. Matched as an address prefix.
 */
export function AllowlistSection() {
  const toast = useToast()
  const entries = useBlocklist()
  const exceptions = entries?.filter((e) => e.kind === 'allow')

  const add = useCallback(
    (text: string) => addOrExplain(() => addAllowException(text), 'blocker.addAllow'),
    [],
  )

  const remove = useCallback(
    async (entry: BlocklistEntry) => {
      try {
        const undoable = await removeBlocklistEntry(entry.id)
        if (undoable)
          toast.show({ title: `Removed ${entry.pattern ?? entry.domain}`, undo: undoable.undo })
      } catch (e) {
        recordError(e, 'blocker.removeAllow')
        toast.error('Couldn’t remove that. Try again.')
      }
    },
    [toast],
  )

  return (
    <Section
      id="exceptions"
      title="Exceptions"
      description="Pages that stay open even when their site is blocked, like one lecture video or a study channel."
    >
      <AddField
        label="Add an exception"
        placeholder="youtube.com/watch?v=… or youtube.com/@CS50"
        hint="Anything that starts with this address is let through."
        buttonLabel="Add"
        onAdd={add}
      />

      {exceptions === undefined ? (
        <div
          className={styles.skeleton}
          role="status"
          aria-busy="true"
          aria-label="Loading exceptions"
        >
          <div className={styles.skeletonRow}>
            <Skeleton variant="block" width={20} height={20} />
            <Skeleton width={220} />
          </div>
        </div>
      ) : exceptions.length === 0 ? (
        <p className={styles.hint}>
          No exceptions. Everything on the blocked list stays blocked, lectures included.
        </p>
      ) : (
        <ul className={styles.list} aria-label="Exceptions">
          {exceptions.map((entry) => {
            const { host, path } = splitPattern(entry.pattern ?? entry.domain)
            return (
              <li key={entry.id} className={styles.row} data-enabled={entry.enabled}>
                <Favicon domain={entry.domain} />
                <span className={styles.text}>
                  <span className={styles.name}>{host}</span>
                  {path ? <span className={styles.detail}>{path}</span> : null}
                </span>
                <span className={styles.controls}>
                  <Toggle
                    size="sm"
                    checked={entry.enabled}
                    aria-label={`Allow ${entry.pattern ?? entry.domain}`}
                    onCheckedChange={(on) => {
                      setBlocklistEntryEnabled(entry.id, on).catch((e: unknown) =>
                        recordError(e, 'blocker.toggleAllow'),
                      )
                    }}
                  />
                  <IconButton
                    size="sm"
                    className={styles.remove}
                    label={`Remove exception ${entry.pattern ?? entry.domain}`}
                    icon={<X />}
                    onClick={() => void remove(entry)}
                  />
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
