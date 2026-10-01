import { Fragment, type ComponentProps } from 'react'
import { isMac } from '@/lib/platform'
import { cx } from '../internal/cx'
import { formatShortcut, spokenShortcut } from './format'
import styles from './Kbd.module.css'

export interface KbdProps extends Omit<ComponentProps<'kbd'>, 'children'> {
  /** Shortcut spec: 'mod+k', 'shift+s', 'g t' (a sequence), '?', 'esc', 'mod+\\'. */
  keys: string
  /** `cap` draws keycaps; `plain` is quiet inline text for menu rows and hints. */
  variant?: 'cap' | 'plain'
  size?: 'sm' | 'md'
  /** Force a platform (for /design); detected from the browser by default. */
  platform?: 'mac' | 'other'
}

/**
 * A keyboard shortcut. Renders ⌘ on macOS and Ctrl elsewhere, one keycap per key, and "then"
 * between the chords of a sequence. Screen readers hear words ("Command K"), not glyphs.
 * Colour follows `--kbd-color` (defaults to --text-muted), so a Tooltip can re-tint it.
 */
export function Kbd({
  keys,
  variant = 'cap',
  size = 'md',
  platform,
  className,
  ...rest
}: KbdProps) {
  const mac = platform ? platform === 'mac' : isMac()
  const groups = formatShortcut(keys, mac)
  return (
    <kbd className={cx(styles.kbd, className)} data-variant={variant} data-size={size} {...rest}>
      <span className={styles.keys} aria-hidden="true">
        {groups.map((caps, i) => (
          <Fragment key={i}>
            {i > 0 && <span className={styles.then}>then</span>}
            {variant === 'plain' ? (
              <span className={styles.chord} data-mac={mac || undefined}>
                {caps.map((cap, j) => (
                  <kbd key={j} className={styles.plainKey}>
                    {cap}
                  </kbd>
                ))}
              </span>
            ) : (
              caps.map((cap, j) => (
                <kbd key={j} className={styles.cap} data-wide={cap.length > 1 || undefined}>
                  {cap}
                </kbd>
              ))
            )}
          </Fragment>
        ))}
      </span>
      <span className="sr-only">{spokenShortcut(keys, mac)}</span>
    </kbd>
  )
}
