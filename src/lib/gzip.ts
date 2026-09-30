/**
 * gzip through the browser's own streams (`CompressionStream`), off the main thread. Snapshots use it so a
 * daily copy of a year of study costs kilobytes, not megabytes, of the person's storage. Where the streams
 * do not exist (an old browser) `gzipText` says so with `null` and the caller stores the plain text.
 */

/** True where both directions exist. */
export function canGzip(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'
}

/** The blob as gzip bytes, or `null` when the browser cannot compress or the attempt failed. */
export async function gzipBlob(source: Blob): Promise<Blob | null> {
  if (!canGzip()) return null
  try {
    const stream = source.stream().pipeThrough(new CompressionStream('gzip'))
    return await new Response(stream).blob()
  } catch {
    return null
  }
}

/** Reads gzip bytes back into text. Throws when the bytes are not gzip. */
export async function gunzipToText(source: Blob): Promise<string> {
  const stream = source.stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}
