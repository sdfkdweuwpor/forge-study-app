/**
 * Chrome derives an extension's ID from its public key: the first 16 bytes of the SHA-256 of the
 * DER key, each hex digit shown as a letter (0 -> a … f -> p). Uses Web Crypto, which exists in
 * browsers, service workers and Node 20+, so the same code runs in the tests.
 */
export async function deriveExtensionId(publicKeyBase64: string): Promise<string> {
  const der = Uint8Array.from(atob(publicKeyBase64), (c) => c.charCodeAt(0))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', der))
  let id = ''
  for (const byte of digest.subarray(0, 16)) {
    id += String.fromCharCode(97 + (byte >> 4), 97 + (byte & 0x0f))
  }
  return id
}
