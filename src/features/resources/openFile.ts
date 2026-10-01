/**
 * Opening a stored PDF: an object URL in a new tab (never an iframe: the CSP and the PDF plugin make that
 * fragile), revoked after a minute, or a download when the browser will not open the tab.
 */
import { getFile } from '@/db/repos/files'
import type { ID } from '@/db/types'
import { downloadBlob } from '@/lib/download'

/** How long an object URL lives after the tab was pointed at it. */
export const REVOKE_AFTER_MS = 60_000

export type OpenOutcome = 'opened' | 'downloaded' | 'missing'

/** The bytes as a PDF whatever the row says, so the browser can only ever show them as one. */
function asPdf(blob: Blob): Blob {
  return blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' })
}

/** A name that ends in `.pdf`, for a download. */
function pdfName(name: string): string {
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`
}

/**
 * Opens the file in a new tab. The tab is opened at once, while the click still counts as a person's
 * action (some browsers, iOS Safari above all, refuse a tab that waits for the database first), and pointed
 * at the PDF when its bytes have been read. If the browser blocks the tab, the PDF is downloaded instead.
 * `missing` means there is no file (a restored backup without its PDFs); nothing was opened.
 */
export async function openPdf(fileId: ID): Promise<OpenOutcome> {
  const tab = window.open('', '_blank')
  try {
    const file = await getFile(fileId)
    if (!file) {
      tab?.close()
      return 'missing'
    }
    const blob = asPdf(file.blob)
    if (tab === null) {
      downloadBlob(pdfName(file.name), blob)
      return 'downloaded'
    }
    const url = URL.createObjectURL(blob)
    try {
      // The new page has no need of this one.
      tab.opener = null
    } catch {
      // Some browsers do not allow it; the PDF is the person's own file either way.
    }
    tab.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
    return 'opened'
  } catch (error) {
    tab?.close()
    throw error
  }
}

/** Saves the file to the device. `missing` when there is no file. */
export async function downloadPdf(fileId: ID): Promise<'downloaded' | 'missing'> {
  const file = await getFile(fileId)
  if (!file) return 'missing'
  downloadBlob(pdfName(file.name), asPdf(file.blob))
  return 'downloaded'
}
