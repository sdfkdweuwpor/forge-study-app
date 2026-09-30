import { describe, expect, it } from 'vitest'
import { APP_ORIGIN, APP_PATH, APP_URL, FALLBACK_ORIGIN } from './config.js'
import { isAllowedOrigin } from './origins.js'

describe('app addresses', () => {
  it('keeps the origin apart from the URL that opens the app', () => {
    expect(APP_ORIGIN).toBe('https://sdfkdweuwpor.github.io')
    expect(APP_URL).toBe('https://sdfkdweuwpor.github.io/forge-study-app/')
    expect(new URL(APP_URL).origin).toBe(APP_ORIGIN)
    expect(new URL(APP_URL).pathname).toBe(APP_PATH)
    expect(FALLBACK_ORIGIN).toBe('https://forge-study-app.netlify.app')
  })
})

describe('isAllowedOrigin', () => {
  it('allows the GitHub Pages app on any of its paths', () => {
    expect(isAllowedOrigin(APP_URL)).toBe(true)
    expect(isAllowedOrigin(`${APP_URL}blocker?tab=schedule#x`)).toBe(true)
    expect(isAllowedOrigin(`${APP_ORIGIN}/forge-study-app`)).toBe(true)
    expect(isAllowedOrigin(`${APP_ORIGIN}/forge-study-app/goals/g1/courses/c182`)).toBe(true)
  })

  it('allows the Netlify fallback on any of its paths', () => {
    expect(isAllowedOrigin(`${FALLBACK_ORIGIN}/`)).toBe(true)
    expect(isAllowedOrigin(`${FALLBACK_ORIGIN}/blocker?tab=schedule#x`)).toBe(true)
  })

  it('does not let the account’s other Pages sites in', () => {
    expect(isAllowedOrigin(`${APP_ORIGIN}/`)).toBe(false)
    expect(isAllowedOrigin(`${APP_ORIGIN}/other-app/`)).toBe(false)
    expect(isAllowedOrigin(`${APP_ORIGIN}/forge-study-app-old/`)).toBe(false)
    expect(isAllowedOrigin(`${APP_ORIGIN}/x/forge-study-app/`)).toBe(false)
    expect(isAllowedOrigin(`${APP_ORIGIN}/forge-study-app/../other-app/`)).toBe(false)
  })

  it('allows http localhost and 127.0.0.1 on any port', () => {
    expect(isAllowedOrigin('http://localhost/')).toBe(true)
    expect(isAllowedOrigin('http://localhost:4173/focus')).toBe(true)
    expect(isAllowedOrigin('http://localhost:4173/forge-study-app/focus')).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:5173/')).toBe(true)
    expect(isAllowedOrigin('http://LOCALHOST:3000/')).toBe(true)
  })

  it('rejects hosts that merely start with an allowed one', () => {
    expect(isAllowedOrigin('http://localhost.evil.com/')).toBe(false)
    expect(isAllowedOrigin('http://localhost.evil.com:4173/')).toBe(false)
    expect(isAllowedOrigin('http://127.0.0.1.evil.com/')).toBe(false)
    expect(isAllowedOrigin(`${APP_ORIGIN}.evil.com/forge-study-app/`)).toBe(false)
    expect(isAllowedOrigin('https://sdfkdweuwpor.github.io.evil.com/forge-study-app/')).toBe(false)
    expect(isAllowedOrigin('https://evil-sdfkdweuwpor.github.io/forge-study-app/')).toBe(false)
    expect(isAllowedOrigin(`${FALLBACK_ORIGIN}.evil.com/`)).toBe(false)
    expect(isAllowedOrigin('https://evil-forge-study-app.netlify.app/')).toBe(false)
  })

  it('rejects credentials tricks', () => {
    expect(isAllowedOrigin('http://localhost@evil.com/')).toBe(false)
    expect(isAllowedOrigin('https://forge-study-app.netlify.app@evil.com/')).toBe(false)
    expect(isAllowedOrigin('https://sdfkdweuwpor.github.io@evil.com/forge-study-app/')).toBe(false)
  })

  it('rejects the wrong scheme', () => {
    expect(isAllowedOrigin('http://forge-study-app.netlify.app/')).toBe(false)
    expect(isAllowedOrigin('http://sdfkdweuwpor.github.io/forge-study-app/')).toBe(false)
    expect(isAllowedOrigin('https://localhost/')).toBe(false)
    expect(isAllowedOrigin('file:///home/user/index.html')).toBe(false)
  })

  it('rejects other Netlify origins such as deploy previews', () => {
    expect(isAllowedOrigin('https://deploy-preview-4--forge-study-app.netlify.app/')).toBe(false)
  })

  it('rejects missing and malformed URLs', () => {
    expect(isAllowedOrigin(undefined)).toBe(false)
    expect(isAllowedOrigin('')).toBe(false)
    expect(isAllowedOrigin('localhost')).toBe(false)
    expect(isAllowedOrigin('not a url')).toBe(false)
  })
})
