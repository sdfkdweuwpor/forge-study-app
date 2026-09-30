import { describe, expect, it } from 'vitest'
import {
  hostMatchesDomain,
  normalizeAllowEntry,
  normalizeBlocklist,
  normalizeDomain,
  resolveReturnUrl,
} from './domains.js'

describe('normalizeDomain', () => {
  it('reduces typed input to a lowercase hostname', () => {
    expect(normalizeDomain('Instagram.com')).toBe('instagram.com')
    expect(normalizeDomain('  https://www.Reddit.com/r/all?x=1#top ')).toBe('www.reddit.com')
    expect(normalizeDomain('twitch.tv:443/somebody')).toBe('twitch.tv')
    expect(normalizeDomain('*.pinterest.com')).toBe('pinterest.com')
    expect(normalizeDomain('x.com.')).toBe('x.com')
  })

  it('converts internationalised names to punycode', () => {
    expect(normalizeDomain('bücher.example')).toBe('xn--bcher-kva.example')
  })

  it('rejects things that are not a domain', () => {
    expect(normalizeDomain('')).toBeNull()
    expect(normalizeDomain('   ')).toBeNull()
    expect(normalizeDomain('localhost')).toBeNull()
    expect(normalizeDomain('not a domain')).toBeNull()
    expect(normalizeDomain('exa*mple.com')).toBeNull()
    expect(normalizeDomain('-bad-.com')).toBeNull()
    expect(normalizeDomain('javascript:alert(1)')).toBeNull()
  })
})

describe('hostMatchesDomain', () => {
  it('matches the domain and its subdomains only', () => {
    expect(hostMatchesDomain('youtube.com', 'youtube.com')).toBe(true)
    expect(hostMatchesDomain('www.youtube.com', 'youtube.com')).toBe(true)
    expect(hostMatchesDomain('a.b.youtube.com', 'youtube.com')).toBe(true)
    expect(hostMatchesDomain('WWW.YouTube.com', 'youtube.com')).toBe(true)
  })

  it('does not match look-alikes', () => {
    expect(hostMatchesDomain('notyoutube.com', 'youtube.com')).toBe(false)
    expect(hostMatchesDomain('youtube.com.evil.com', 'youtube.com')).toBe(false)
    expect(hostMatchesDomain('youtube.co', 'youtube.com')).toBe(false)
    expect(hostMatchesDomain('com', 'youtube.com')).toBe(false)
  })
})

describe('normalizeBlocklist', () => {
  it('drops invalid entries and duplicates, keeping order', () => {
    expect(normalizeBlocklist(['x.com', 'X.COM', '', 'nonsense', 'reddit.com', 'https://x.com/home'])).toEqual([
      'x.com',
      'reddit.com',
    ])
  })

  it('drops subdomains already covered by a parent entry', () => {
    expect(normalizeBlocklist(['m.youtube.com', 'youtube.com', 'music.youtube.com', 'twitch.tv'])).toEqual([
      'youtube.com',
      'twitch.tv',
    ])
  })

  it('keeps a subdomain entry when its parent is not listed', () => {
    expect(normalizeBlocklist(['old.reddit.com'])).toEqual(['old.reddit.com'])
  })
})

describe('normalizeAllowEntry', () => {
  it('keeps host and path, lowercases the host, strips scheme and fragment', () => {
    expect(normalizeAllowEntry('youtube.com/watch?v=aBc123')).toBe('youtube.com/watch?v=aBc123')
    expect(normalizeAllowEntry('https://YouTube.com/@SomeChannel#about')).toBe('youtube.com/@SomeChannel')
    expect(normalizeAllowEntry('reddit.com')).toBe('reddit.com')
    expect(normalizeAllowEntry('reddit.com/r/productivity/')).toBe('reddit.com/r/productivity/')
  })

  it('rejects wildcard characters, whitespace and bad hosts', () => {
    expect(normalizeAllowEntry('youtube.com/*')).toBeNull()
    expect(normalizeAllowEntry('youtube.com/a^b')).toBeNull()
    expect(normalizeAllowEntry('youtube.com/a|b')).toBeNull()
    expect(normalizeAllowEntry('youtube.com/a b')).toBeNull()
    expect(normalizeAllowEntry('/watch?v=abc')).toBeNull()
    expect(normalizeAllowEntry('')).toBeNull()
  })
})

describe('resolveReturnUrl', () => {
  it('returns the original URL when it is http(s) on the blocked domain or a subdomain', () => {
    expect(resolveReturnUrl('https://www.instagram.com/p/abc?x=1&y=2#z', 'instagram.com')).toBe(
      'https://www.instagram.com/p/abc?x=1&y=2#z',
    )
    expect(resolveReturnUrl('http://instagram.com/', 'instagram.com')).toBe('http://instagram.com/')
  })

  it('falls back to the site front page for another host', () => {
    expect(resolveReturnUrl('https://evil.example/', 'instagram.com')).toBe('https://instagram.com/')
    expect(resolveReturnUrl('https://instagram.com.evil.example/', 'instagram.com')).toBe('https://instagram.com/')
    expect(resolveReturnUrl('https://notinstagram.com/', 'instagram.com')).toBe('https://instagram.com/')
    expect(resolveReturnUrl('https://instagram.com@evil.example/', 'instagram.com')).toBe('https://instagram.com/')
  })

  it('falls back for non-http(s) schemes and garbage', () => {
    expect(resolveReturnUrl('javascript:alert(1)', 'instagram.com')).toBe('https://instagram.com/')
    expect(resolveReturnUrl('data:text/html,<p>hi</p>', 'instagram.com')).toBe('https://instagram.com/')
    expect(resolveReturnUrl('chrome-extension://abc/blocked.html', 'instagram.com')).toBe('https://instagram.com/')
    expect(resolveReturnUrl('file:///etc/passwd', 'instagram.com')).toBe('https://instagram.com/')
    expect(resolveReturnUrl('', 'instagram.com')).toBe('https://instagram.com/')
    expect(resolveReturnUrl('not a url', 'instagram.com')).toBe('https://instagram.com/')
  })
})
