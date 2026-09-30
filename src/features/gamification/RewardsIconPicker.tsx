import { useRef, useState, type KeyboardEvent } from 'react'
import { Popover, PopoverBody } from '@/ui/Popover'
import styles from './RewardsIconPicker.module.css'

interface RewardEmoji {
  char: string
  name: string
}

/** Icons for treats: play, food and drink, screens, shopping, rest and getting out. */
export const REWARD_EMOJI: readonly RewardEmoji[] = [
  { char: '🎮', name: 'Video game' },
  { char: '🕹️', name: 'Joystick' },
  { char: '📺', name: 'Television' },
  { char: '🎬', name: 'Clapper board' },
  { char: '🍿', name: 'Popcorn' },
  { char: '🎧', name: 'Headphones' },
  { char: '☕', name: 'Coffee' },
  { char: '🧋', name: 'Bubble tea' },
  { char: '🍕', name: 'Pizza' },
  { char: '🍔', name: 'Burger' },
  { char: '🥡', name: 'Takeout box' },
  { char: '🍣', name: 'Sushi' },
  { char: '🍦', name: 'Ice cream' },
  { char: '🍩', name: 'Donut' },
  { char: '🍰', name: 'Cake' },
  { char: '🍻', name: 'Clinking beers' },
  { char: '🛍️', name: 'Shopping bags' },
  { char: '👟', name: 'Sneaker' },
  { char: '📖', name: 'Open book' },
  { char: '🎨', name: 'Artist palette' },
  { char: '🎸', name: 'Guitar' },
  { char: '🎳', name: 'Bowling' },
  { char: '🏀', name: 'Basketball' },
  { char: '⚽', name: 'Soccer ball' },
  { char: '🚗', name: 'Car' },
  { char: '🌴', name: 'Palm tree' },
  { char: '🏖️', name: 'Beach' },
  { char: '🛌', name: 'Person in bed' },
  { char: '🎉', name: 'Party popper' },
  { char: '🎁', name: 'Gift' },
]

const COLUMNS = 6

interface Props {
  /** The current icon. */
  value: string
  /** Names the trigger: the reward's title, or `null` while the reward is still being written. */
  rewardTitle: string | null
  onPick: (icon: string) => void
}

/** The reward's icon as a button; it opens a grid of treats. Picking one saves it. Esc closes without a change. */
export function RewardsIconPicker({ value, rewardTitle, onPick }: Props) {
  return (
    <Popover
      label={rewardTitle ? `Icon for ${rewardTitle}` : 'Icon'}
      align="start"
      trigger={(p) => (
        <button
          {...p}
          type="button"
          className={styles.trigger}
          aria-label={rewardTitle ? `Change icon for ${rewardTitle}` : 'Choose an icon'}
        >
          <span aria-hidden="true">{value}</span>
        </button>
      )}
    >
      {({ close }) => (
        <PopoverBody>
          <Grid
            current={value}
            onPick={(icon) => {
              close()
              if (icon !== value) onPick(icon)
            }}
          />
        </PopoverBody>
      )}
    </Popover>
  )
}

/** One tab stop (roving tabindex), arrows move, Home/End jump. The popover focuses `[data-autofocus]`. */
function Grid({ current, onPick }: { current: string; onPick: (icon: string) => void }) {
  const grid = useRef<HTMLDivElement>(null)
  const start = Math.max(
    0,
    REWARD_EMOJI.findIndex((e) => e.char === current),
  )
  const [focusIndex, setFocusIndex] = useState(start)

  function move(to: number) {
    const next = Math.min(REWARD_EMOJI.length - 1, Math.max(0, to))
    setFocusIndex(next)
    grid.current?.querySelectorAll<HTMLElement>('[data-cell]')[next]?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const deltas: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    }
    const delta = deltas[e.key]
    if (delta !== undefined) {
      e.preventDefault()
      move(focusIndex + delta)
    } else if (e.key === 'Home') {
      e.preventDefault()
      move(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      move(REWARD_EMOJI.length - 1)
    }
  }

  return (
    // Arrow keys are handled on the group; the cells are the interactive elements.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- roving-tabindex group
    <div ref={grid} role="group" aria-label="Icons" className={styles.grid} onKeyDown={onKeyDown}>
      {REWARD_EMOJI.map((emoji, i) => (
        <button
          key={emoji.char}
          type="button"
          data-cell=""
          data-autofocus={i === focusIndex ? '' : undefined}
          tabIndex={i === focusIndex ? 0 : -1}
          className={styles.cell}
          aria-label={emoji.name}
          aria-pressed={emoji.char === current}
          onClick={() => onPick(emoji.char)}
        >
          <span aria-hidden="true">{emoji.char}</span>
        </button>
      ))}
    </div>
  )
}
