import { describe, expect, it } from 'vitest'
import { DEFAULT_EXTENSION_ID } from './config.js'
import { deriveExtensionId } from './extensionId.js'

// The public key from extension/manifest.json (manifest.test.ts checks the manifest itself matches).
const KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtzlniRJfA7SNvBCwMwTedIzTiprS7b3UoM+HTo3Og9aDBYycXih7YNq1Jfr1282dFEO2R7R9qaGX99aXijiVf6XaxkGcjCb4o3jF60EX3d8+WtID8EJ8wGhkyAXKvHfeEC8kEIsefGdcsSx8ypG/M/FIuvhg5xoZHQ32mIfn7CNHkKSPGFFJuZRZiselXkMiJ3uizEUsGKdOG0WvZ3jt026PyhuRD5974Hpxl3pYZQ24/CX5FFIlVu7MdemdFwJ2HuUGJWmy7S6vXNjA+O6hGyl0UOq00NEHcdxvPgQf06WcAXTDYlccvdwffG7AUKc1EsZC+a4JIGsr538LEb26ZwIDAQAB'

describe('deriveExtensionId', () => {
  it('maps the manifest key to the stable extension ID', async () => {
    expect(await deriveExtensionId(KEY)).toBe(DEFAULT_EXTENSION_ID)
  })

  it('yields 32 letters from a to p', async () => {
    expect(await deriveExtensionId(KEY)).toMatch(/^[a-p]{32}$/)
    expect(await deriveExtensionId('AAAA')).toMatch(/^[a-p]{32}$/)
  })

  it('differs for a different key', async () => {
    expect(await deriveExtensionId('AAAB')).not.toBe(await deriveExtensionId(KEY))
  })
})
