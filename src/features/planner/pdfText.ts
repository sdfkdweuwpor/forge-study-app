import { pagesToText, type PdfTextItem } from '@/logic/pdfLines'

/** A syllabus is small; anything bigger is probably not one, and reading it would stall the tab. */
export const MAX_PDF_BYTES = 25 * 1024 * 1024
export const MAX_PDF_PAGES = 80

export type PdfFailure = 'tooLarge' | 'tooManyPages' | 'noText' | 'encrypted' | 'unreadable'

export type PdfResult =
  { ok: true; text: string; pages: number } | { ok: false; reason: PdfFailure }

export const PDF_FAILURE_TEXT: Readonly<Record<PdfFailure, string>> = {
  tooLarge: 'That PDF is larger than 25 MB. Try a smaller export of just the syllabus.',
  tooManyPages: `That PDF has more than ${MAX_PDF_PAGES} pages. Try just the pages with the course list.`,
  noText:
    'This PDF has no text Forge can read. It is probably a scan. Use the photo path with Claude instead.',
  encrypted: 'This PDF is password protected. Remove the password and try again.',
  unreadable: 'Forge could not read that PDF. Paste the text instead, or use the photo path.',
}

interface RawItem {
  str?: unknown
  transform?: unknown
  width?: unknown
  hasEOL?: unknown
}

function toItem(raw: RawItem): PdfTextItem | null {
  if (typeof raw.str !== 'string' || !Array.isArray(raw.transform)) return null
  const t = raw.transform as unknown[]
  const x = Number(t[4])
  const y = Number(t[5])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return {
    str: raw.str,
    x,
    y,
    width: typeof raw.width === 'number' ? raw.width : raw.str.length * 5,
    ...(raw.hasEOL === true ? { hasEOL: true } : {}),
  }
}

/**
 * Reads the text of a PDF on this device. pdf.js and its worker are loaded only now (the worker is a
 * separate file served from this origin, so it runs under `worker-src 'self'`); nothing is uploaded.
 */
export async function extractPdfText(file: File): Promise<PdfResult> {
  if (file.size > MAX_PDF_BYTES) return { ok: false, reason: 'tooLarge' }
  try {
    const [pdfjs, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ])
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    const data = new Uint8Array(await file.arrayBuffer())
    const task = pdfjs.getDocument({ data })
    try {
      const doc = await task.promise
      if (doc.numPages > MAX_PDF_PAGES) return { ok: false, reason: 'tooManyPages' }
      const pages: PdfTextItem[][] = []
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n)
        const content = await page.getTextContent()
        pages.push(
          content.items.flatMap((i) => {
            const item = toItem(i as RawItem)
            return item ? [item] : []
          }),
        )
      }
      const text = pagesToText(pages)
      return text.trim() === ''
        ? { ok: false, reason: 'noText' }
        : { ok: true, text, pages: doc.numPages }
    } finally {
      await task.destroy()
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    return { ok: false, reason: name === 'PasswordException' ? 'encrypted' : 'unreadable' }
  }
}
