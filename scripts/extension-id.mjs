/**
 * Prints the extension ID that Chrome derives from the `key` in extension/manifest.json:
 *
 *   node scripts/extension-id.mjs        ->  gpinhblnpebjbiodblihfpjbffacipbd
 *
 * Same algorithm as extension/src/shared/extensionId.ts (which the unit tests use); this copy is
 * plain Node so a build script can call it before anything is compiled. A test keeps them equal.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * First 16 bytes of the SHA-256 of the DER public key, each hex digit shown as a letter (0 -> a … f -> p).
 * @param {string} publicKeyBase64 the manifest `key`
 * @returns {string}
 */
export function deriveExtensionId(publicKeyBase64) {
  const hex = createHash('sha256')
    .update(Buffer.from(publicKeyBase64, 'base64'))
    .digest('hex')
    .slice(0, 32)
  return [...hex].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join('')
}

/** The `key` from extension/manifest.json. */
export function readManifestKey() {
  const manifest = JSON.parse(
    readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'),
  )
  return manifest.key
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${deriveExtensionId(readManifestKey())}\n`)
}
