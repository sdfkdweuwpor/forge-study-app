import { Copy, ExternalLink, Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { copyText } from '@/lib/clipboard'
import { parseApiKey, parseProjectUrl } from '@/logic/syncConfig'
import { Button } from '@/ui/Button'
import { IconButton } from '@/ui/IconButton'
import { Input } from '@/ui/Input'
import { useToast } from '@/ui/Toast'
import { SETUP_SQL } from './setupSql'
import styles from './SyncSection.module.css'

/** The README's setup walkthrough (12B6 writes the "Sync (optional)" section this points at). */
export const SETUP_GUIDE_URL = 'https://github.com/sdfkdweuwpor/forge-study-app#sync-optional'

/** "How to set up Supabase": opens the README's walkthrough in a new tab. */
export function SetupGuideLink() {
  return (
    <a className={styles.link} href={SETUP_GUIDE_URL} target="_blank" rel="noopener noreferrer">
      How to set up Supabase
      <ExternalLink aria-hidden="true" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

/**
 * "Copy setup SQL": the SQL of PLAN §4.7.3 on the clipboard, with a way to read it when the clipboard is
 * not available (a browser that refuses it, a person who wants to see what they are about to run).
 */
export function CopySqlButton({ variant = 'secondary' }: { variant?: 'secondary' | 'ghost' }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  async function copy() {
    const ok = await copyText(SETUP_SQL)
    if (ok) {
      setCopied(true)
      toast.success('Copied the setup SQL', {
        description: 'Paste it into the SQL editor of your Supabase project and run it once.',
      })
    } else {
      toast.error('Couldn’t copy the setup SQL', { description: 'Use “Show the SQL” and copy it by hand.' })
    }
  }

  return (
    <Button variant={variant} iconLeft={<Copy />} onClick={() => void copy()}>
      {copied ? 'Copied the setup SQL' : 'Copy setup SQL'}
    </Button>
  )
}

/** The SQL itself, folded away: for anyone who wants to read what they are about to run. */
export function SqlPreview() {
  return (
    <details>
      <summary className={styles.summary}>Show the SQL</summary>
      <textarea className={styles.sql} aria-label="Setup SQL" readOnly rows={12} value={SETUP_SQL} />
    </details>
  )
}

interface FieldErrors {
  url: string | null
  key: string | null
}

const NO_ERRORS: FieldErrors = { url: null, key: null }

interface SetupFormProps {
  /** What is saved now, when the person is changing the project. */
  initial: { url: string; anonKey: string } | null
  /** The project was checked and saved. */
  onSaved?: () => void
  onCancel?: () => void
}

/**
 * Setting up: the project's address and its anon (public) key, each checked on blur with the one-line
 * reason of §4.7.2, then "Check connection" asks the project itself. Only a project that answers is saved,
 * and it stays on this device.
 */
export function SetupForm({ initial, onSaved, onCancel }: SetupFormProps) {
  const toast = useToast()
  const [url, setUrl] = useState(initial?.url ?? '')
  const [key, setKey] = useState(initial?.anonKey ?? '')
  const [show, setShow] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>(NO_ERRORS)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const urlField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    urlField.current?.focus()
  }, [])

  /** The key is judged against the address: it may have been right for the one typed before. */
  const keyProblem = (): string | null => {
    if (key.trim() === '') return null
    const address = parseProjectUrl(url)
    const parsed = parseApiKey(key, address.ok ? address.value.ref : null)
    return parsed.ok ? null : parsed.issue.message
  }

  function checkUrl() {
    if (url.trim() === '') return
    const parsed = parseProjectUrl(url)
    setErrors({ url: parsed.ok ? null : parsed.issue.message, key: keyProblem() })
  }

  function checkKey() {
    setErrors((e) => ({ ...e, key: keyProblem() }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      const { checkAndSaveProject } = await import('./actions')
      const result = await checkAndSaveProject(url, key)
      if (result.ok) {
        setErrors(NO_ERRORS)
        toast.success('Connected to your project')
        onSaved?.()
        return
      }
      setErrors({
        url: result.issues.find((i) => i.field === 'url')?.message ?? null,
        key: result.issues.find((i) => i.field === 'key')?.message ?? null,
      })
      setMessage(result.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
      <h3 className={styles.title}>Your Supabase project</h3>
      <Input
        ref={urlField}
        label="Project URL"
        type="url"
        inputMode="url"
        value={url}
        placeholder="https://abcdefghijklmnopqrst.supabase.co"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        hint="From Project Settings → API in your Supabase dashboard."
        error={errors.url}
        disabled={busy}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={checkUrl}
      />
      <Input
        label="Anon (public) key"
        type={show ? 'text' : 'password'}
        value={key}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        hint="This key is meant to be public. Never paste the service-role or secret key."
        error={errors.key}
        disabled={busy}
        onChange={(e) => setKey(e.target.value)}
        onBlur={checkKey}
        trailing={
          <IconButton
            label={show ? 'Hide key' : 'Show key'}
            icon={show ? <EyeOff /> : <Eye />}
            size="xs"
            tooltip={false}
            pressed={show}
            onClick={() => setShow((s) => !s)}
          />
        }
      />
      {message !== null ? (
        <p className={styles.notice} data-tone="attention" role="alert">
          {message}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={busy}>
          Check connection
        </Button>
        <CopySqlButton />
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        ) : null}
      </div>
      <p className={styles.help}>
        Run the setup SQL once in your project’s SQL editor. It is safe to run again. Your address and key
        stay on this device.
      </p>
      <SqlPreview />
    </form>
  )
}
