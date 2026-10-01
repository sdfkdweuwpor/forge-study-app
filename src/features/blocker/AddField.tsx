import { Plus } from 'lucide-react'
import { useState, type FormEvent, type Ref } from 'react'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'
import styles from './AddField.module.css'

interface Props {
  label: string
  placeholder: string
  hint?: string
  /** Adds the typed text. Resolve to `null` when added, or to a message to show under the field. */
  onAdd: (text: string) => Promise<string | null>
  inputRef?: Ref<HTMLInputElement>
  buttonLabel?: string
}

/** One line to add something to a list: type, Enter (or the button), and a plain message if it can't be added. */
export function AddField({
  label,
  placeholder,
  hint,
  onAdd,
  inputRef,
  buttonLabel = 'Add',
}: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const problem = await onAdd(text)
      setError(problem)
      if (problem === null) setText('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
      <Input
        ref={inputRef}
        className={styles.input}
        aria-label={label}
        value={text}
        placeholder={placeholder}
        hint={hint}
        error={error}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        inputMode="url"
        onChange={(e) => {
          setText(e.target.value)
          if (error) setError(null)
        }}
      />
      <Button
        type="submit"
        variant="secondary"
        iconLeft={<Plus />}
        loading={busy}
        className={styles.button}
      >
        {buttonLabel}
      </Button>
    </form>
  )
}
