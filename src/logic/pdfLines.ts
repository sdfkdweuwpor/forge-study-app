/**
 * PDF text items → plain text lines (pure). pdf.js hands back small runs of text with their position;
 * a syllabus reads properly only when runs on the same baseline are joined into one line. The planner
 * feeds the result to `parsePlanText`, so the PDF never leaves the device.
 */
export interface PdfTextItem {
  str: string
  /** Left edge and baseline in PDF points (y grows upward). */
  x: number
  y: number
  width: number
  /** pdf.js sets it on the last run of a line. */
  hasEOL?: boolean
}

/** Runs closer than this many points on the same baseline are one line. */
const SAME_LINE = 2.5

/** One page's items as lines, top to bottom, left to right within a line. */
export function itemsToLines(items: readonly PdfTextItem[]): string[] {
  const runs = items.filter((i) => i.str.trim() !== '' || i.hasEOL)
  const rows: Array<{ y: number; items: PdfTextItem[] }> = []
  for (const item of runs) {
    const row = rows.find((r) => Math.abs(r.y - item.y) <= SAME_LINE)
    if (row) row.items.push(item)
    else rows.push({ y: item.y, items: [item] })
  }
  rows.sort((a, b) => b.y - a.y)
  const lines: string[] = []
  for (const row of rows) {
    const sorted = [...row.items].sort((a, b) => a.x - b.x)
    let text = ''
    let prevEnd: number | null = null
    for (const item of sorted) {
      if (item.str === '') continue
      if (text !== '' && !text.endsWith(' ') && !item.str.startsWith(' ')) {
        const gap = prevEnd === null ? 1 : item.x - prevEnd
        if (gap > 1) text += ' '
      }
      text += item.str
      prevEnd = item.x + item.width
    }
    const line = text.replace(/\s+/g, ' ').trim()
    if (line !== '') lines.push(line)
  }
  return lines
}

/** All pages as text, one line per row, a blank line between pages. */
export function pagesToText(pages: readonly (readonly PdfTextItem[])[]): string {
  return pages
    .map((p) => itemsToLines(p).join('\n'))
    .filter((t) => t !== '')
    .join('\n\n')
}

/**
 * Why a PDF read threw. pdf.js loads as a separate chunk on first use, so with no connection (and nothing
 * cached yet) the failure is the download, not the file: the person needs to hear that, not "unreadable".
 */
export function readFailureKind(
  errorName: string,
  online: boolean,
): 'encrypted' | 'offline' | 'unreadable' {
  if (errorName === 'PasswordException') return 'encrypted'
  return online ? 'unreadable' : 'offline'
}
