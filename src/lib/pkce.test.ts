import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codeChallengeS256, createCodeVerifier } from '@/lib/pkce'

const UNRESERVED = /^[A-Za-z0-9\-._~]+$/

afterEach(() => vi.unstubAllGlobals())

describe('codeChallengeS256', () => {
  it('matches the RFC 7636 appendix B vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(await codeChallengeS256(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('is base64url of SHA-256, without padding, for verifiers of every allowed length', async () => {
    for (const length of [43, 64, 86, 128]) {
      const verifier = 'a1-._~Z'.repeat(20).slice(0, length)
      const challenge = await codeChallengeS256(verifier)
      expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
      expect(challenge).toHaveLength(43)
      expect(challenge).not.toMatch(/[=+/]/)
    }
  })

  it('is deterministic and changes with the verifier', async () => {
    expect(await codeChallengeS256('x'.repeat(43))).toBe(await codeChallengeS256('x'.repeat(43)))
    expect(await codeChallengeS256('x'.repeat(43))).not.toBe(
      await codeChallengeS256('y'.repeat(43)),
    )
  })

  it('says why when the page has no crypto.subtle (an insecure origin)', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    await expect(codeChallengeS256('x'.repeat(43))).rejects.toThrow('secure')
  })
})

describe('createCodeVerifier', () => {
  it('is 43–128 characters from the RFC 7636 unreserved alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const verifier = createCodeVerifier()
      expect(verifier.length).toBeGreaterThanOrEqual(43)
      expect(verifier.length).toBeLessThanOrEqual(128)
      expect(verifier).toMatch(UNRESERVED)
    }
  })

  it('draws its bytes from crypto.getRandomValues, all 48 of them', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues')
    const verifier = createCodeVerifier()
    expect(spy).toHaveBeenCalledTimes(1)
    const buffer = spy.mock.calls[0]?.[0]
    expect(buffer).toBeInstanceOf(Uint8Array)
    expect((buffer as Uint8Array).length).toBe(48)
    expect(Buffer.from(verifier, 'base64url')).toEqual(Buffer.from(buffer as Uint8Array))
  })

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 500 }, createCodeVerifier))
    expect(seen.size).toBe(500)
  })

  it('maps to a well-formed challenge', async () => {
    const challenge = await codeChallengeS256(createCodeVerifier())
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})
