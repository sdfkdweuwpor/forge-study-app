import { describe, expect, it } from 'vitest'
import manifest from '../manifest.json'
import { APP_ORIGIN, DEFAULT_EXTENSION_ID, FALLBACK_ORIGIN } from './shared/config.js'
import { deriveExtensionId } from './shared/extensionId.js'

describe('manifest.json', () => {
  it('has a key that hashes to DEFAULT_EXTENSION_ID', async () => {
    expect(await deriveExtensionId(manifest.key)).toBe(DEFAULT_EXTENSION_ID)
  })

  it('lets only the app (GitHub Pages and Netlify) and localhost talk to the extension', () => {
    expect(manifest.externally_connectable.matches).toEqual([
      `${APP_ORIGIN}/*`,
      `${FALLBACK_ORIGIN}/*`,
      'http://localhost/*',
      'http://127.0.0.1/*',
    ])
  })

  it('asks for the permissions the code uses and nothing more', () => {
    expect([...manifest.permissions].sort()).toEqual(['alarms', 'declarativeNetRequest', 'storage'])
    expect(manifest.host_permissions).toEqual(['*://*/*'])
  })

  it('exposes only blocked.html, and only to http(s) pages', () => {
    expect(manifest.web_accessible_resources).toEqual([
      { resources: ['blocked.html'], matches: ['http://*/*', 'https://*/*'] },
    ])
  })

  it('is a module service worker with a popup and all four icon sizes', () => {
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.background).toEqual({ service_worker: 'js/background/sw.js', type: 'module' })
    expect(manifest.action.default_popup).toBe('popup.html')
    expect(Object.keys(manifest.icons)).toEqual(['16', '32', '48', '128'])
  })
})
