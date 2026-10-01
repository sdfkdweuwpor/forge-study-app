import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './OverlayPortal.module.css'

const SCOPE_ATTRS = ['data-theme', 'data-accent', 'data-reduced-motion'] as const

/**
 * Theme, accent and reduced-motion settings that apply to `origin`, when they come from a
 * sub-tree rather than <html>. Overlays are portaled to <body>, so without this a popover opened
 * inside the dark column of /design would render in the page theme.
 */
function scopeOf(origin: Element | null | undefined): Record<string, string> {
  const scope: Record<string, string> = {}
  if (!origin) return scope
  const root = document.documentElement
  for (const attr of SCOPE_ATTRS) {
    const holder = origin.closest(`[${attr}]`)
    const value = holder?.getAttribute(attr)
    if (holder && holder !== root && value) scope[attr] = value
  }
  return scope
}

interface OverlayPortalProps {
  /** An element inside the themed sub-tree the overlay belongs to (the trigger, or a marker). */
  origin?: Element | null
  children: ReactNode
}

/** Renders children into <body> inside a box-less wrapper that carries the origin's theme. */
export function OverlayPortal({ origin, children }: OverlayPortalProps) {
  return createPortal(
    <div className={styles.scope} {...scopeOf(origin)}>
      {children}
    </div>,
    document.body,
  )
}
