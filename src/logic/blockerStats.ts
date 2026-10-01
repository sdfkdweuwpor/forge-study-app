/**
 * Blocker statistics (BRIEF §5.8), pure. Every blocked attempt is a win: the numbers here are framed
 * that way ("You tried Instagram 7 times today, that's 7 wins"), and the emergency-unlock log is a
 * neutral, honest record: a date, a site and the minutes, with no judgement in the wording.
 *
 * Sites are matched by domain (`hostMatchesDomain`), never by substring, so `netflix.com` is Netflix
 * and not X, and `m.youtube.com` is YouTube.
 */
import type { BlockEvent, ISODate } from '@/db/types'
import { hostMatchesDomain } from '@ext/domains'
import { addDays } from './dates'

// ─── Names ──────────────────────────────────────────────────────────────────

interface Brand {
  name: string
  /** The first one is the site's main domain. */
  domains: readonly string[]
}

const BRANDS: readonly Brand[] = [
  { name: 'Instagram', domains: ['instagram.com'] },
  { name: 'TikTok', domains: ['tiktok.com'] },
  { name: 'YouTube', domains: ['youtube.com', 'youtu.be'] },
  { name: 'X', domains: ['x.com', 'twitter.com'] },
  { name: 'Reddit', domains: ['reddit.com'] },
  { name: 'Facebook', domains: ['facebook.com'] },
  { name: 'Snapchat', domains: ['snapchat.com'] },
  { name: 'Netflix', domains: ['netflix.com'] },
  { name: 'Twitch', domains: ['twitch.tv'] },
  { name: 'Pinterest', domains: ['pinterest.com'] },
]

const clean = (domain: string): string =>
  domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')

function brandOf(domain: string): Brand | undefined {
  const host = clean(domain)
  return BRANDS.find((b) => b.domains.some((d) => hostMatchesDomain(host, d)))
}

/** `co`, `com`, `org`… in front of a two-letter country code (`bbc.co.uk`, `abc.net.au`). */
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac'])

/** The label people know a site by: `docs.reddit.com` → `reddit`, `bbc.co.uk` → `bbc`. */
function siteLabel(host: string): string {
  const labels = host.split('.').filter((l) => l !== '')
  if (labels.length <= 1) return labels[0] ?? host
  const last = labels[labels.length - 1] ?? ''
  const before = labels[labels.length - 2] ?? ''
  if (labels.length >= 3 && last.length === 2 && SECOND_LEVEL.has(before)) {
    return labels[labels.length - 3] ?? before
  }
  return before
}

const capitalise = (word: string): string =>
  word === '' ? word : word.charAt(0).toUpperCase() + word.slice(1)

/**
 * A domain as a person says it: instagram.com → Instagram, x.com and twitter.com → X,
 * youtube.com (and m.youtube.com) → YouTube, anything else → its capitalised second-level name
 * (khanacademy.org → Khanacademy).
 */
export function prettyDomainName(domain: string): string {
  const host = clean(domain)
  const brand = brandOf(host)
  if (brand) return brand.name
  return capitalise(siteLabel(host))
}

/** The key a site's numbers are grouped under: twitter.com and x.com are one site, so are m.youtube.com and youtube.com. */
export function siteKey(domain: string): string {
  const host = clean(domain)
  return brandOf(host)?.domains[0] ?? host
}

// ─── Counting ───────────────────────────────────────────────────────────────

export interface SiteCount {
  /** The grouping key, also a domain that can be used for a favicon. */
  domain: string
  /** "Instagram". */
  name: string
  count: number
}

/** Blocked attempts per site, most first (ties by name), for the events that pass `keep`. */
function countAttempts(
  events: readonly BlockEvent[],
  keep: (e: BlockEvent) => boolean,
): SiteCount[] {
  const counts = new Map<string, number>()
  for (const e of events) {
    if (e.kind !== 'attempt' || !keep(e)) continue
    const key = siteKey(e.domain)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([domain, count]) => ({ domain, name: prettyDomainName(domain), count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export interface AttemptSummary {
  total: number
  /** Per site, most attempts first. */
  sites: SiteCount[]
}

function summarise(sites: SiteCount[]): AttemptSummary {
  return { total: sites.reduce((sum, s) => sum + s.count, 0), sites }
}

/** Today's blocked attempts. */
export function attemptsOn(events: readonly BlockEvent[], day: ISODate): AttemptSummary {
  return summarise(countAttempts(events, (e) => e.day === day))
}

/** Blocked attempts over the last `days` days, today included. */
export function attemptsInLastDays(
  events: readonly BlockEvent[],
  today: ISODate,
  days: number,
): AttemptSummary {
  const from = addDays(today, -(Math.max(1, days) - 1))
  return summarise(countAttempts(events, (e) => e.day >= from && e.day <= today))
}

// ─── Words ──────────────────────────────────────────────────────────────────

/** "once", "twice", "7 times". */
export function timesText(n: number): string {
  if (n === 1) return 'once'
  if (n === 2) return 'twice'
  return `${n} times`
}

/** "1 win", "7 wins". */
export function winsText(n: number): string {
  return n === 1 ? '1 win' : `${n} wins`
}

/** "You tried Instagram 7 times today, that's 7 wins". */
export function winsSentence(site: Pick<SiteCount, 'name' | 'count'>): string {
  return `You tried ${site.name} ${timesText(site.count)} today, that’s ${winsText(site.count)}`
}

/** The line under today's number: the sentence for the most-tried site, or a calm note when there are none. */
export function todayHeadline(summary: AttemptSummary): string {
  const top = summary.sites[0]
  if (top === undefined) return 'Nothing to block so far today. The blocker is on watch.'
  return winsSentence(top)
}

// ─── The unlock log ─────────────────────────────────────────────────────────

export interface UnlockEntry {
  id: string
  at: number
  day: ISODate
  domain: string
  name: string
  minutes: number
}

/** Emergency unlocks, newest first. `minutes` falls back to the extension's 5 for an older record without one. */
export function unlockLog(events: readonly BlockEvent[], limit = 50): UnlockEntry[] {
  return events
    .filter((e) => e.kind === 'unlock')
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.max(0, limit))
    .map((e) => ({
      id: e.id,
      at: e.at,
      day: e.day,
      domain: e.domain,
      name: prettyDomainName(e.domain),
      minutes: e.minutes ?? 5,
    }))
}
