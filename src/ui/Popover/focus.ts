const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Tabbable descendants of `root` in DOM order, skipping hidden and inert ones. */
export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0 && !el.closest('[inert]'),
  )
}

/** Moves focus into an overlay: `[data-autofocus]`, else the first tabbable, else the container itself. */
export function focusInside(root: HTMLElement, preferred?: HTMLElement | null): void {
  const target =
    preferred ?? root.querySelector<HTMLElement>('[data-autofocus]') ?? getFocusable(root)[0]
  if (target) {
    target.focus({ preventScroll: true })
    return
  }
  if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
  root.focus({ preventScroll: true })
}
