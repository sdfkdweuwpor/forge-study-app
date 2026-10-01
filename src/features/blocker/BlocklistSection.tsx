import { RotateCcw, ShieldOff, X } from 'lucide-react'
import { useCallback, useEffect, useState, type Ref } from 'react'
import { recordError } from '@/app/reportError'
import {
  addBlockedDomain,
  removeBlocklistEntry,
  restoreDefaultBlocklist,
  seedDefaultBlocklist,
  setBlocklistEntryEnabled,
} from '@/db/repos/blocker'
import type { BlocklistEntry } from '@/db/types'
import { prettyDomainName } from '@/logic/blockerStats'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { IconButton } from '@/ui/IconButton'
import { Skeleton } from '@/ui/Skeleton'
import { Toggle } from '@/ui/Toggle'
import { useToast } from '@/ui/Toast'
import { AddField } from './AddField'
import { addOrExplain } from './addOrExplain'
import { Favicon } from './Favicon'
import { useBlockerSettings, useBlocklist, useMissingDefaults } from './queries'
import { Section } from './Section'
import styles from './List.module.css'

/** The sites that are blocked: add, switch off, remove (with Undo), and restore the defaults. */
export function BlocklistSection({ inputRef }: { inputRef: Ref<HTMLInputElement> }) {
  const toast = useToast()
  const settings = useBlockerSettings()
  const entries = useBlocklist()
  const missing = useMissingDefaults()
  const [seedError, setSeedError] = useState<unknown>(null)
  // The default list is added at app start; this covers opening the page before that has finished, and
  // shows loading (never a flash of "no sites") until it has. A failure goes to the section's error state.
  useEffect(() => {
    seedDefaultBlocklist().catch((e: unknown) => setSeedError(e ?? new Error('Seeding failed')))
  }, [])
  if (seedError !== null) throw seedError
  const sites =
    settings?.blocklistSeeded === true ? entries?.filter((e) => e.kind === 'block') : undefined

  const add = useCallback(
    (text: string) => addOrExplain(() => addBlockedDomain(text), 'blocker.addDomain'),
    [],
  )

  const remove = useCallback(
    async (entry: BlocklistEntry) => {
      try {
        const undoable = await removeBlocklistEntry(entry.id)
        if (undoable) {
          toast.show({ title: `Removed ${entry.domain}`, undo: undoable.undo })
        }
      } catch (e) {
        recordError(e, 'blocker.remove')
        toast.error('Couldn’t remove that. Try again.')
      }
    },
    [toast],
  )

  const restore = useCallback(async () => {
    try {
      const n = await restoreDefaultBlocklist()
      toast.success(n === 1 ? 'Restored 1 default site' : `Restored ${n} default sites`)
    } catch (e) {
      recordError(e, 'blocker.restore')
      toast.error('Couldn’t restore the defaults. Try again.')
    }
  }, [toast])

  const toggle = (entry: BlocklistEntry, enabled: boolean) => {
    setBlocklistEntryEnabled(entry.id, enabled).catch((e: unknown) =>
      recordError(e, 'blocker.toggle'),
    )
  }

  return (
    <Section
      id="sites"
      title="Blocked sites"
      description="Each site and everything under it (like m.youtube.com) is redirected to a calm page while the blocker is on."
      actions={
        sites !== undefined && sites.length > 0 ? (
          <span className={styles.count}>
            {sites.filter((s) => s.enabled).length} of {sites.length} on
          </span>
        ) : null
      }
    >
      <AddField
        label="Add a site to block"
        placeholder="Add a site, like reddit.com"
        onAdd={add}
        inputRef={inputRef}
      />

      {sites === undefined ? (
        <div
          className={styles.skeleton}
          role="status"
          aria-busy="true"
          aria-label="Loading blocked sites"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.skeletonRow}>
              <Skeleton variant="block" width={20} height={20} />
              <Skeleton width={i % 2 === 0 ? 140 : 100} />
            </div>
          ))}
        </div>
      ) : sites.length === 0 ? (
        <EmptyState
          size="sm"
          align="start"
          titleAs="h3"
          icon={<ShieldOff />}
          title="No sites are blocked"
          description="Add a site above, or bring back the usual suspects: Instagram, TikTok, YouTube and the rest."
          action={
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<RotateCcw />}
              onClick={() => void restore()}
            >
              Restore defaults
            </Button>
          }
        />
      ) : (
        <ul className={styles.list} aria-label="Blocked sites">
          {sites.map((site) => (
            <li key={site.id} className={styles.row} data-enabled={site.enabled}>
              <Favicon domain={site.domain} />
              <span className={styles.text}>
                <span className={styles.name}>{prettyDomainName(site.domain)}</span>
                <span className={styles.detail}>{site.domain}</span>
              </span>
              <span className={styles.controls}>
                <Toggle
                  size="sm"
                  checked={site.enabled}
                  aria-label={`Block ${site.domain}`}
                  onCheckedChange={(on) => toggle(site, on)}
                />
                <IconButton
                  size="sm"
                  className={styles.remove}
                  label={`Remove ${site.domain}`}
                  icon={<X />}
                  onClick={() => void remove(site)}
                />
              </span>
            </li>
          ))}
        </ul>
      )}

      {missing !== undefined && missing > 0 && sites !== undefined && sites.length > 0 ? (
        <div>
          <Button variant="ghost" size="sm" iconLeft={<RotateCcw />} onClick={() => void restore()}>
            Restore defaults ({missing})
          </Button>
        </div>
      ) : null}
    </Section>
  )
}
