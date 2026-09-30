import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNow } from '@/app/hooks/useNow'
import type { SyncStateView } from '@/db/hooks/useSyncState'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'
import { NEEDS_CODE_TEXT, NEEDS_EMAIL_TEXT, cleanEmailCode, looksLikeEmail } from '@/logic/syncLink'
import { clearLinkMessage } from './linkReturn'
import styles from './SyncSection.module.css'

/** How long "Send again" waits (Supabase rate-limits its emails, and a second one helps no one sooner). */
export const RESEND_WAIT_S = 60

const actions = () => import('./actions')

/**
 * Step one: the email the sign-in link and code go to. The address is prefilled with the one used before,
 * which is what "Sign in again" needs.
 */
function EmailStep({ email: initial, again }: { email: string | null; again: boolean }) {
  const [email, setEmail] = useState(initial ?? '')
  const [busy, setBusy] = useState(false)
  // What is typed cannot be sent (under the field), or Supabase would not send it (a calm notice below).
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Someone who is signing in again has nothing else to do here: start on the field.
    if (again) field.current?.focus()
  }, [again])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setMessage(null)
    if (!looksLikeEmail(email)) {
      setFieldError(NEEDS_EMAIL_TEXT)
      return
    }
    setFieldError(null)
    setBusy(true)
    try {
      const result = await (await actions()).sendSignInLink(email)
      if (result.ok) clearLinkMessage()
      else setMessage(result.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
      <Input
        ref={field}
        label="Email"
        type="email"
        inputMode="email"
        value={email}
        placeholder="you@example.com"
        autoComplete="email"
        autoCapitalize="off"
        spellCheck={false}
        hint="Forge emails a sign-in link and a code. There is no password."
        error={fieldError}
        disabled={busy}
        onChange={(e) => setEmail(e.target.value)}
      />
      {message !== null ? (
        <p className={styles.notice} data-tone="attention" role="alert">
          {message}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={busy}>
          Send sign-in link
        </Button>
      </div>
    </form>
  )
}

/**
 * Step two: the email is on its way. The link signs in the tab that asked for it; the code is the way in
 * for an installed phone app, whose storage a link from Mail cannot reach.
 */
function WaitingStep({ email, requestedAt }: { email: string; requestedAt: number }) {
  const now = useNow('second')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'code' | 'again' | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const waitS = Math.min(
    RESEND_WAIT_S,
    Math.max(0, RESEND_WAIT_S - Math.floor((now - requestedAt) / 1000)),
  )

  async function signIn(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setMessage(null)
    if (cleanEmailCode(code) === null) {
      setFieldError(NEEDS_CODE_TEXT)
      return
    }
    setFieldError(null)
    setBusy('code')
    try {
      const result = await (await actions()).signInWithEmailCode(code)
      if (!result.ok) setMessage(result.message)
    } finally {
      setBusy(null)
    }
  }

  async function again() {
    if (busy || waitS > 0) return
    setBusy('again')
    setMessage(null)
    setSent(false)
    try {
      const result = await (await actions()).sendSignInLink(email)
      if (result.ok) {
        clearLinkMessage()
        setSent(true)
      } else setMessage(result.message)
    } finally {
      setBusy(null)
    }
  }

  async function other() {
    if (busy) return
    clearLinkMessage()
    await (await actions()).forgetPendingLogin()
  }

  return (
    <div className={styles.step}>
      <p className={styles.lead}>
        We sent a sign-in link to <strong>{email}</strong>. Open it on this device. In the phone
        app, type the code from the email instead.
      </p>
      <form className={styles.form} onSubmit={(e) => void signIn(e)} noValidate>
        <Input
          className={styles.codeInput}
          label="Code from the email"
          value={code}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={12}
          placeholder="123456"
          error={fieldError}
          disabled={busy === 'code'}
          onChange={(e) => setCode(e.target.value)}
        />
        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={busy === 'code'}>
            Sign in
          </Button>
          <Button loading={busy === 'again'} disabled={waitS > 0} onClick={() => void again()}>
            {waitS > 0 ? `Send again (${waitS}s)` : 'Send again'}
          </Button>
          <Button variant="ghost" disabled={busy !== null} onClick={() => void other()}>
            Use another email
          </Button>
        </div>
      </form>
      {message !== null ? (
        <p className={styles.notice} data-tone="attention" role="alert">
          {message}
        </p>
      ) : null}
      <p className={styles.help} role="status">
        {sent ? 'Sent again. The newest email is the one that works.' : ''}
      </p>
    </div>
  )
}

interface SignInProps {
  view: SyncStateView
  /** Signing in again after being signed out, not setting up: the field takes the focus. */
  again?: boolean
}

/** The email step, or waiting for the email once one was sent. */
export function SignIn({ view, again = false }: SignInProps) {
  return view.pendingLogin !== null ? (
    <WaitingStep email={view.pendingLogin.email} requestedAt={view.pendingLogin.requestedAt} />
  ) : (
    <EmailStep email={view.email} again={again} />
  )
}
