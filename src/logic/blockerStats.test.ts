import { describe, expect, it } from 'vitest'
import type { BlockEvent } from '@/db/types'
import {
  attemptsInLastDays,
  attemptsOn,
  prettyDomainName,
  siteKey,
  timesText,
  todayHeadline,
  unlockLog,
  winsSentence,
  winsText,
} from './blockerStats'

let n = 0
const event = (domain: string, day: string, over: Partial<BlockEvent> = {}): BlockEvent => {
  n += 1
  return {
    id: `e${n}`,
    createdAt: n,
    updatedAt: n,
    at: new Date(`${day}T10:00:00-04:00`).getTime() + n,
    day,
    kind: 'attempt',
    domain,
    minutes: null,
    ...over,
  }
}

describe('prettyDomainName', () => {
  it('names the known sites', () => {
    expect(prettyDomainName('instagram.com')).toBe('Instagram')
    expect(prettyDomainName('tiktok.com')).toBe('TikTok')
    expect(prettyDomainName('youtube.com')).toBe('YouTube')
    expect(prettyDomainName('x.com')).toBe('X')
    expect(prettyDomainName('twitter.com')).toBe('X')
    expect(prettyDomainName('reddit.com')).toBe('Reddit')
    expect(prettyDomainName('facebook.com')).toBe('Facebook')
    expect(prettyDomainName('snapchat.com')).toBe('Snapchat')
    expect(prettyDomainName('netflix.com')).toBe('Netflix')
    expect(prettyDomainName('twitch.tv')).toBe('Twitch')
    expect(prettyDomainName('pinterest.com')).toBe('Pinterest')
  })

  it('never matches by substring: netflix.com is Netflix, not X', () => {
    expect(prettyDomainName('netflix.com')).toBe('Netflix')
    expect(prettyDomainName('box.com')).toBe('Box')
    expect(prettyDomainName('dropbox.com')).toBe('Dropbox')
    expect(prettyDomainName('notyoutube.com')).toBe('Notyoutube')
    expect(prettyDomainName('mexico.com')).toBe('Mexico')
    expect(prettyDomainName('xbox.com')).toBe('Xbox')
  })

  it('a subdomain of a known site is that site', () => {
    expect(prettyDomainName('m.youtube.com')).toBe('YouTube')
    expect(prettyDomainName('www.instagram.com')).toBe('Instagram')
    expect(prettyDomainName('mobile.twitter.com')).toBe('X')
    expect(prettyDomainName('old.reddit.com')).toBe('Reddit')
  })

  it('anything else is its capitalised second-level name', () => {
    expect(prettyDomainName('khanacademy.org')).toBe('Khanacademy')
    expect(prettyDomainName('news.ycombinator.com')).toBe('Ycombinator')
    expect(prettyDomainName('bbc.co.uk')).toBe('Bbc')
    expect(prettyDomainName('www.bbc.co.uk')).toBe('Bbc')
    expect(prettyDomainName('WWW.Example.COM')).toBe('Example')
  })

  it('copes with odd input', () => {
    expect(prettyDomainName('')).toBe('')
    expect(prettyDomainName('localhost')).toBe('Localhost')
  })
})

describe('siteKey', () => {
  it('groups aliases and subdomains under the main domain', () => {
    expect(siteKey('twitter.com')).toBe('x.com')
    expect(siteKey('x.com')).toBe('x.com')
    expect(siteKey('m.youtube.com')).toBe('youtube.com')
    expect(siteKey('WWW.Khanacademy.org')).toBe('khanacademy.org')
    expect(siteKey('netflix.com')).toBe('netflix.com')
  })
})

describe('wording', () => {
  it('says how many times and how many wins', () => {
    expect(timesText(1)).toBe('once')
    expect(timesText(2)).toBe('twice')
    expect(timesText(7)).toBe('7 times')
    expect(winsText(1)).toBe('1 win')
    expect(winsText(7)).toBe('7 wins')
  })

  it('frames an attempt as a win', () => {
    expect(winsSentence({ name: 'Instagram', count: 7 })).toBe(
      'You tried Instagram 7 times today, that’s 7 wins',
    )
    expect(winsSentence({ name: 'Reddit', count: 1 })).toBe(
      'You tried Reddit once today, that’s 1 win',
    )
  })

  it('a quiet day is a calm sentence', () => {
    const headline = todayHeadline({ total: 0, sites: [] })
    expect(headline).toMatch(/on watch/)
    expect(headline).not.toMatch(/fail|shame|only|but/i)
  })
})

describe('attempts', () => {
  const events = [
    event('instagram.com', '2026-09-29'),
    event('instagram.com', '2026-09-29'),
    event('www.instagram.com', '2026-09-29'),
    event('twitter.com', '2026-09-29'),
    event('x.com', '2026-09-29'),
    event('netflix.com', '2026-09-29'),
    event('reddit.com', '2026-09-28'),
    event('reddit.com', '2026-08-01'),
    event('reddit.com', '2026-09-29', { kind: 'unlock', minutes: 5 }),
  ]

  it('counts today per site, most first, merging aliases', () => {
    const today = attemptsOn(events, '2026-09-29')
    expect(today.total).toBe(6)
    expect(today.sites).toEqual([
      { domain: 'instagram.com', name: 'Instagram', count: 3 },
      { domain: 'x.com', name: 'X', count: 2 },
      { domain: 'netflix.com', name: 'Netflix', count: 1 },
    ])
  })

  it('netflix is counted as Netflix, never as X', () => {
    const netflixOnly = attemptsOn([event('netflix.com', '2026-09-29')], '2026-09-29')
    expect(netflixOnly.sites.map((s) => s.name)).toEqual(['Netflix'])
  })

  it('unlocks are not attempts', () => {
    expect(attemptsOn(events, '2026-09-29').sites.some((s) => s.domain === 'reddit.com')).toBe(
      false,
    )
  })

  it('breaks ties by name', () => {
    const tie = attemptsOn(
      [event('reddit.com', '2026-09-29'), event('facebook.com', '2026-09-29')],
      '2026-09-29',
    )
    expect(tie.sites.map((s) => s.name)).toEqual(['Facebook', 'Reddit'])
  })

  it('the last 30 days include today and stop 29 days back', () => {
    const inRange = [
      event('reddit.com', '2026-09-29'),
      event('reddit.com', '2026-08-31'), // day 30
      event('reddit.com', '2026-08-30'), // day 31: out
      event('reddit.com', '2026-10-01'), // the future: out
    ]
    expect(attemptsInLastDays(inRange, '2026-09-29', 30).total).toBe(2)
    expect(attemptsInLastDays(inRange, '2026-09-29', 1).total).toBe(1)
  })

  it('an empty list is zero, not an error', () => {
    expect(attemptsOn([], '2026-09-29')).toEqual({ total: 0, sites: [] })
  })
})

describe('unlockLog', () => {
  it('lists unlocks newest first, neutrally', () => {
    const log = unlockLog([
      event('reddit.com', '2026-09-27', { kind: 'unlock', minutes: 5 }),
      event('reddit.com', '2026-09-28'),
      event('youtube.com', '2026-09-29', { kind: 'unlock', minutes: 5 }),
      event('twitter.com', '2026-09-28', { kind: 'unlock', minutes: null }),
    ])
    expect(log.map((u) => [u.day, u.name, u.minutes])).toEqual([
      ['2026-09-29', 'YouTube', 5],
      ['2026-09-28', 'X', 5],
      ['2026-09-27', 'Reddit', 5],
    ])
  })

  it('respects the limit', () => {
    const many = Array.from({ length: 5 }, () =>
      event('reddit.com', '2026-09-29', { kind: 'unlock', minutes: 5 }),
    )
    expect(unlockLog(many, 2)).toHaveLength(2)
    expect(unlockLog(many, 0)).toHaveLength(0)
  })
})
