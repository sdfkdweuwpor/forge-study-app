import { Plus } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  DEFAULT_REWARD_ICON,
  MAX_REWARD_PRICE,
  MAX_REWARD_TITLE_LENGTH,
  cleanRewardTitle,
  formatXpNumber,
  parseRewardPrice,
} from '@/logic/rewards'
import { Button } from '@/ui/Button'
import { Input } from '@/ui/Input'
import { Kbd } from '@/ui/Kbd'
import type { RewardActions } from './RewardsActions'
import { RewardsIconPicker } from './RewardsIconPicker'
import styles from './RewardsNewRow.module.css'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  actions: RewardActions
}

/**
 * The last row of the shop. Closed, it is a quiet "New reward" line; open, it is one line of fields:
 * icon, title, price. Enter adds and keeps the row open for the next one; Esc closes it.
 */
export function RewardsNewRow({ open, onOpenChange, actions }: Props) {
  const [icon, setIcon] = useState(DEFAULT_REWARD_ICON)
  const [title, setTitle] = useState('')
  const [price, setPrice] = useState('')
  const [titleError, setTitleError] = useState<string | null>(null)
  const [priceError, setPriceError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const titleInput = useRef<HTMLInputElement | null>(null)
  const form = useRef<HTMLFormElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (open) titleInput.current?.focus()
    else if (wasOpen.current) trigger.current?.focus()
    wasOpen.current = open
  }, [open])

  // Esc anywhere in the row closes it. A native listener, so an Esc that closes the icon picker (which
  // renders elsewhere in the page) does not also close the row.
  const closeRow = useRef<() => void>(() => undefined)
  useEffect(() => {
    closeRow.current = () => {
      setIcon(DEFAULT_REWARD_ICON)
      setTitle('')
      setPrice('')
      setTitleError(null)
      setPriceError(null)
      onOpenChange(false)
    }
  })
  useEffect(() => {
    const el = form.current
    if (!open || !el) return undefined
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return
      e.preventDefault()
      e.stopPropagation()
      closeRow.current()
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [open])

  function reset() {
    setIcon(DEFAULT_REWARD_ICON)
    setTitle('')
    setPrice('')
    setTitleError(null)
    setPriceError(null)
  }

  function close() {
    reset()
    onOpenChange(false)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    const cleanTitle = cleanRewardTitle(title)
    const parsed = parseRewardPrice(price)
    setTitleError(cleanTitle === '' ? 'Give the reward a name.' : null)
    setPriceError(
      parsed === null ? `A whole number of XP, 1 to ${formatXpNumber(MAX_REWARD_PRICE)}.` : null,
    )
    if (cleanTitle === '' || parsed === null) {
      if (cleanTitle === '') titleInput.current?.focus()
      return
    }
    setSaving(true)
    const saved = await actions.create({ title: cleanTitle, price: parsed, icon })
    setSaving(false)
    if (saved) {
      reset()
      titleInput.current?.focus()
    }
  }

  if (!open) {
    return (
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        onClick={() => onOpenChange(true)}
      >
        <span className={styles.plus} aria-hidden="true">
          <Plus size={16} />
        </span>
        <span>New reward</span>
        <Kbd keys="n" size="sm" className={styles.hint} />
      </button>
    )
  }

  return (
    <form
      ref={form}
      className={styles.form}
      aria-label="New reward"
      onSubmit={(e) => void submit(e)}
    >
      <div className={styles.icon}>
        <RewardsIconPicker
          value={icon}
          rewardTitle={cleanRewardTitle(title) || null}
          onPick={setIcon}
        />
      </div>
      <Input
        ref={titleInput}
        aria-label="Reward title"
        placeholder="30 min gaming"
        maxLength={MAX_REWARD_TITLE_LENGTH}
        autoComplete="off"
        value={title}
        error={titleError}
        onChange={(e) => {
          setTitle(e.target.value)
          setTitleError(null)
        }}
      />
      <Input
        className={styles.price}
        aria-label="Price in XP"
        placeholder="300"
        inputMode="numeric"
        autoComplete="off"
        trailing={<span className={styles.xp}>XP</span>}
        value={price}
        error={priceError}
        onChange={(e) => {
          setPrice(e.target.value)
          setPriceError(null)
        }}
      />
      <div className={styles.buttons}>
        <Button type="submit" variant="primary" loading={saving}>
          Add
        </Button>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
