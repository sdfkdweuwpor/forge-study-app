import { describe, expect, it } from 'vitest'
import { APP_ORIGIN } from './config.js'
import { isAllowedOrigin } from './origins.js'

describe('isAllowedOrigin', () => {
  it('allows the deployed app on any of its paths', () => {
    expect(isAllowedOrigin(`${APP_ORIGIN}/`)).toBe(true)
    expect(isAllowedOrigin(`${APP_ORIGIN}/blocker?tab=schedule#x`)).toBe(true)
  })

  it('allows http localhost and 127.0.0.1 on any port', () => {
    expect(isAllowedOrigin('http://localhost/')).toBe(true)
    expect(isAllowedOrigin('http://localhost:4173/focus')).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:5173/')).toBe(true)
    expect(isAllowedOrigin('http://LOCALHOST:3000/')).toBe(true)
  })

  it('rejects hosts that merely start with an allowed one', () => {
    expect(isAllowedOrigin('http://localhost.evil.com/')).toBe(false)
    expect(isAllowedOrigin('http://localhost.evil.com:4173/')).toBe(false)
    expect(isAllowedOrigin('http://127.0.0.1.evil.com/')).toBe(false)
    expect(isAllowedOrigin(`${APP_ORIGIN}.evil.com/`)).toBe(false)
    expect(isAllowedOrigin('https://forge-study-app.netlify.app.evil.com/')).toBe(false)
    expect(isAllowedOrigin('https://evil-forge-study-app.netlify.app/')).toBe(false)
  })

  it('rejects credentials tricks', () => {
    expect(isAllowedOrigin('http://localhost@evil.com/')).toBe(false)
    expect(isAllowedOrigin('https://forge-study-app.netlify.app@evil.com/')).toBe(false)
  })

  it('rejects the wrong scheme', () => {
    expect(isAllowedOrigin('http://forge-study-app.netlify.app/')).toBe(false)
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
