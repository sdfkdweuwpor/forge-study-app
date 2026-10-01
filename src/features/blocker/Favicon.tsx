import { useState } from 'react'
import { tagColor } from '@/logic/tagColor'
import { prettyDomainName } from '@/logic/blockerStats'
import styles from './Favicon.module.css'

/** DuckDuckGo's favicon service: no key, and `img-src` in security-headers.mjs allows this one host. */
export const faviconUrl = (domain: string): string =>
  `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`

/**
 * A site's icon. The letter avatar is always underneath, so a slow, blocked or offline lookup (or a
 * site with no icon) just shows the avatar; the real icon covers it once it has loaded.
 */
export function Favicon({ domain, size = 20 }: { domain: string; size?: 16 | 20 | 24 }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const letter = prettyDomainName(domain).charAt(0).toUpperCase() || '?'
  return (
    <span
      className={styles.icon}
      data-size={size}
      data-color={tagColor(domain)}
      data-loaded={(loaded && !failed) || undefined}
      aria-hidden="true"
    >
      <span className={styles.letter}>{letter}</span>
      {failed ? null : (
        <img
          className={styles.image}
          src={faviconUrl(domain)}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  )
}
