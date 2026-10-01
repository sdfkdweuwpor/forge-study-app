import { describe, expect, it } from 'vitest'
import { DEFAULT_EXTENSION_ID } from '../extension/src/shared/config'
import { deriveExtensionId as deriveInBrowser } from '../extension/src/shared/extensionId'
import { deriveExtensionId, readManifestKey } from './extension-id.mjs'

describe('scripts/extension-id.mjs', () => {
  it('derives DEFAULT_EXTENSION_ID from the manifest key', () => {
    expect(deriveExtensionId(readManifestKey())).toBe(DEFAULT_EXTENSION_ID)
  })

  it('agrees with the Web Crypto implementation the extension tests use', async () => {
    for (const key of [readManifestKey(), 'AAAA', 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE']) {
      expect(deriveExtensionId(key)).toBe(await deriveInBrowser(key))
    }
  })
})
