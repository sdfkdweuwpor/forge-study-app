import { Copy, Download, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { recordError } from '@/app/reportError'
import { checkExtension, isConnected, useConnection, type Connection } from '@/features/blocker'
import { EXTENSION_ZIP_URL } from '@/config'
import { copyText } from '@/lib/clipboard'
import { Button } from '@/ui/Button'
import { IconButton } from '@/ui/IconButton'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/Toast'
import extStyles from './ExtensionStep.module.css'
import styles from './steps.module.css'

// The same two support pages the Blocker page links to.
const IOS_SCREEN_TIME = 'https://support.apple.com/en-us/108806'
const ANDROID_WELLBEING = 'https://support.google.com/android/answer/9346420'

/** The headline of the status line. */
export function extensionStatusText(c: Connection): string {
  switch (c.phase) {
    case 'checking':
      return 'Looking for the extension…'
    case 'connected':
      return c.version === 'unknown' ? 'Connected' : `Connected · v${c.version}`
    case 'unavailable':
      return c.reason === 'no-runtime' || c.reason === 'unreachable'
        ? 'Not installed yet'
        : 'Installed, but not answering'
  }
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a className={styles.link} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

/**
 * Step 4: the Chrome extension. The status is live (the blocker's sync asks the extension every so
 * often, and "Check again" asks right now); the steps hide once it answers. Nothing here is required:
 * "I'll do it later" finishes setup as it is, and the Blocker page has the same steps.
 */
export function ExtensionStep() {
  const toast = useToast()
  const conn = useConnection()
  const [rechecking, setRechecking] = useState(false)
  const connected = isConnected(conn)
  const firstCheck = conn.phase === 'checking' && conn.checkedAt === null

  // Ask again on arrival: the answer may be a minute old, and the person may have installed it since.
  useEffect(() => {
    checkExtension().catch((e: unknown) => recordError(e, 'onboarding.extension'))
  }, [])

  function recheck() {
    setRechecking(true)
    checkExtension()
      .catch((e: unknown) => recordError(e, 'onboarding.extension'))
      .finally(() => setRechecking(false))
  }

  async function copy() {
    const ok = await copyText('chrome://extensions')
    if (ok) toast.success('Copied chrome://extensions')
    else toast.error('Couldn’t copy. Type chrome://extensions in the address bar.')
  }

  return (
    <div className={styles.step}>
      <div className={styles.section}>
        {firstCheck ? (
          <div
            className={extStyles.status}
            role="status"
            aria-busy="true"
            aria-label="Looking for the extension"
          >
            <Skeleton variant="circle" width={10} />
            <Skeleton width={160} />
          </div>
        ) : (
          <div className={extStyles.statusRow}>
            <p
              className={extStyles.status}
              role="status"
              data-state={connected ? 'on' : 'off'}
              data-testid="extension-status"
            >
              <span className={extStyles.dot} aria-hidden="true" />
              {extensionStatusText(conn)}
            </p>
            <Button
              variant="ghost"
              size="sm"
              iconLeft={<RefreshCw />}
              loading={rechecking}
              onClick={recheck}
            >
              Check again
            </Button>
          </div>
        )}

        {connected ? (
          <p className={styles.hint}>
            You’re set. Whatever you change on the Blocker page reaches the extension, and it keeps
            blocking when this tab is closed.
          </p>
        ) : (
          <ol className={extStyles.steps}>
            <li>
              <span>
                Download <strong>forge-extension.zip</strong> and unzip it.
              </span>
              <a
                className={extStyles.download}
                href={EXTENSION_ZIP_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download aria-hidden="true" /> Download the extension
              </a>
            </li>
            <li>
              <span>
                Open <code className={extStyles.code}>chrome://extensions</code> in a new tab.
              </span>
              <IconButton
                size="xs"
                label="Copy chrome://extensions"
                icon={<Copy />}
                onClick={() => void copy()}
              />
            </li>
            <li>
              <span>
                Switch on <strong>Developer mode</strong> (top right).
              </span>
            </li>
            <li>
              <span>
                Click <strong>Load unpacked</strong> and pick the unzipped folder.
              </span>
            </li>
            <li>
              <span>Come back here. Forge notices within a minute, or press Check again.</span>
            </li>
          </ol>
        )}
      </div>

      <p className={styles.small}>
        On a phone? An extension can’t block phone apps. Use{' '}
        <ExternalLink href={IOS_SCREEN_TIME}>Screen Time on iPhone</ExternalLink> or{' '}
        <ExternalLink href={ANDROID_WELLBEING}>Digital Wellbeing on Android</ExternalLink>.
      </p>
    </div>
  )
}
