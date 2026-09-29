/**
 * Normalises a pasted cover image link. Only http(s) links are accepted; anything else
 * (`javascript:`, `data:`, a bare word) returns null so the picker can show an error.
 */
export function parseCoverUrl(input: string): string | null {
  const text = input.trim()
  if (text === '' || /\s/.test(text)) return null
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null
    return url.toString()
  } catch {
    return null
  }
}
