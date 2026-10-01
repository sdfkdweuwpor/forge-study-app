import { Copy, Download, RefreshCw } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { setExtensionIdOverride } from '@/db/repos/blocker'
import { recordError } from '@/app/reportError'
import { copyText } from '@/lib/clipboard'
import { DEFAULT_EXTENSION_ID, EXTENSION_ZIP_URL } from '@/config'
import { Button } from '@/ui/Button'
import { IconButton } from '@/ui/IconButton'
import { Input } from '@/ui/Input'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/Toast'
import { isAllowedOrigin } from '@ext/origins'
import { useConnection, type Connection } from './connection'
import { useBlockerSettings } from './queries'
import { Section } from './Section'
import { checkExtension } from './sync'
import styles from './ConnectionSection.module.css'

const IOS_SCREEN_TIME = 'https://support.apple.com/en-us/108806'
const ANDROID_WELLBEING = 'https://support.google.com/android/answer/9346420'

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a className={styles.link} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

/** The headline of the status line: "Connected · v1.0.0", "Not installed"… */
export function statusText(c: Connection): string {
  switch (c.phase) {
    case 'checking':
      return 'Checking…'
    case 'connected':
      return c.version === 'unknown' ? 'Connected' : `Connected · v${c.version}`
    case 'unavailable':
      return c.reason === 'no-runtime' || c.reason === 'unreachable'
        ? 'Not installed'
        : 'Not responding'
  }
}

function InstallSteps() {
  const toast = useToast()
  const copy = async () => {
    const ok = await copyText('chrome://extensions')
    if (ok) toast.success('Copied chrome://extensions')
    else toast.error('Couldn’t copy. Type chrome://extensions in the address bar.')
  }
  return (
    <ol className={styles.steps}>
      <li>
        <span>
          Download <strong>forge-extension.zip</strong> and unzip it.
        </span>
        <a
          className={styles.download}
          href={EXTENSION_ZIP_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Download aria-hidden="true" /> Download the extension
        </a>
        <span className={styles.note}>
          The repository is private, so GitHub asks you to sign in first.
        </span>
      </li>
      <li>
        <span>
          Open <code className={styles.code}>chrome://extensions</code> in a new tab.
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
        <span>
          Come back here. This page notices the extension within a minute, or press Check again.
        </span>
      </li>
    </ol>
  )
}

/** Lets you point the app at a different extension ID (a build with another key). */
function IdOverride({
  override,
  open,
  onOpenChange,
}: {
  override: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const toast = useToast()
  const [value, setValue] = useState(override ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(next: string) {
    setSaving(true)
    try {
      const id = await setExtensionIdOverride(next)
      setError(null)
      toast.success(id === null ? 'Using the built-in extension ID' : 'Extension ID saved')
      await checkExtension()
    } catch (e) {
      if (e instanceof RangeError) setError(e.message)
      else {
        recordError(e, 'blocker.extensionId')
        setError('Couldn’t save that. Try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void save(value)
  }

  return (
    <details
      className={styles.advanced}
      open={open}
      onToggle={(e) => onOpenChange(e.currentTarget.open)}
    >
      <summary className={styles.summary}>Using a different extension ID?</summary>
      <form className={styles.idForm} onSubmit={submit} noValidate>
        <Input
          label="Extension ID"
          value={value}
          placeholder={DEFAULT_EXTENSION_ID}
          hint="Copy it from chrome://extensions. Leave it empty to use the built-in ID."
          error={error}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setValue(e.target.value)
            if (error) setError(null)
          }}
        />
        <div className={styles.idActions}>
          <Button type="submit" variant="secondary" size="sm" loading={saving}>
            Save ID
          </Button>
          {override !== null ? (
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => void save('')}>
              Use the built-in ID
            </Button>
          ) : null}
        </div>
      </form>
    </details>
  )
}

function lastSyncedText(at: number | null | undefined): string | null {
  if (!at) return null
  return `Synced ${new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

/**
 * The extension's connection: connected (with its version), or not installed with the install steps,
 * the extension-ID override, and the notes about other web addresses and phones.
 */
export function ConnectionSection() {
  const conn = useConnection()
  const settings = useBlockerSettings()
  const [originOk] = useState(() => isAllowedOrigin(window.location.href))
  // Held here so the field stays open when saving swaps it for a fresh one.
  const [idOpen, setIdOpen] = useState(false)
  // "Check again" keeps what is on screen (the steps, the version) and only spins the button.
  const [rechecking, setRechecking] = useState(false)
  const recheck = () => {
    setRechecking(true)
    void checkExtension().finally(() => setRechecking(false))
  }
  const checking = conn.phase === 'checking'

  const missing =
    conn.phase === 'unavailable' && (conn.reason === 'no-runtime' || conn.reason === 'unreachable')
  const stuck = conn.phase === 'unavailable' && !missing

  return (
    <Section
      id="extension"
      title="Chrome extension"
      description="Websites can’t block other websites, so a small companion extension does the blocking. This page tells it what to block."
      actions={
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<RefreshCw />}
          loading={checking || rechecking}
          onClick={recheck}
        >
          Check again
        </Button>
      }
    >
      <div className={styles.body}>
        {checking && conn.checkedAt === null ? (
          <div
            className={styles.status}
            role="status"
            aria-busy="true"
            aria-label="Checking for the extension"
          >
            <Skeleton variant="circle" width={10} />
            <Skeleton width={160} />
          </div>
        ) : (
          <p
            className={styles.status}
            role="status"
            data-state={conn.phase === 'connected' ? 'on' : 'off'}
          >
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.statusText}>{statusText(conn)}</span>
            {conn.phase === 'connected' ? (
              <span className={styles.statusMeta}>
                {lastSyncedText(settings?.lastSyncedAt) ?? 'Ready'}
              </span>
            ) : null}
          </p>
        )}

        {conn.phase === 'connected' ? (
          <p className={styles.text}>
            Your list is on its way to the extension whenever you change it. Blocking keeps working
            when this tab is closed.
          </p>
        ) : null}

        {stuck && conn.phase === 'unavailable' ? (
          <p className={styles.text} role="alert">
            The extension is there but didn’t answer properly: {conn.message} Try again, or reload
            the extension in chrome://extensions.
          </p>
        ) : null}

        {missing ? (
          <>
            {!originOk ? (
              <p className={styles.warning} role="note">
                This address ({window.location.origin}) isn’t one the extension listens to. It only
                connects to the deployed Forge site, localhost and 127.0.0.1, so Netlify deploy
                previews on other addresses can’t connect.
              </p>
            ) : null}
            <InstallSteps />
            <p className={styles.text}>
              Already installed? Check that it is switched on and that its ID matches the one below.
              The extension only talks to the deployed Forge site, localhost and 127.0.0.1, so a
              Netlify deploy preview on another address can’t connect.
            </p>
          </>
        ) : null}

        {conn.phase !== 'checking' || conn.checkedAt !== null ? (
          <IdOverride
            key={settings?.extensionIdOverride ?? ''}
            override={settings?.extensionIdOverride ?? null}
            open={idOpen}
            onOpenChange={setIdOpen}
          />
        ) : null}

        <p className={styles.phone}>
          On a phone? An extension can’t block phone apps. Use{' '}
          <ExternalLink href={IOS_SCREEN_TIME}>Screen Time on iPhone</ExternalLink> or{' '}
          <ExternalLink href={ANDROID_WELLBEING}>Digital Wellbeing on Android</ExternalLink>.
        </p>
      </div>
    </Section>
  )
}
