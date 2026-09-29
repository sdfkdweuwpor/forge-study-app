import { createContext, useContext } from 'react'
import type { ToastVariant } from './toastReducer'

/** A plain action button on a toast ("Open"). Runs `onClick`, then the toast closes. */
export interface ToastButton {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  /** Reuse an id to update a toast in place ("Saving…" → "Saved"). Generated when omitted. */
  id?: string
  title: string
  description?: string
  /** Default 'default'. Errors are announced assertively. */
  variant?: ToastVariant
  /** Auto-dismiss delay in ms; 0 keeps it until dismissed. Defaults by variant, longer with Undo. */
  duration?: number
  /**
   * Adds an Undo button. It runs this, then the toast reads "Undone". If it throws or rejects,
   * the toast says it could not undo and offers Retry.
   */
  undo?: () => void | Promise<void>
  /** Adds an action button beside Undo, e.g. `{ label: 'Open', onClick }`. */
  action?: ToastButton
}

/** Options for the variant helpers, which set `title` and `variant` themselves. */
export type ToastExtras = Omit<ToastOptions, 'title' | 'variant'>

export interface ToastApi {
  /** Shows a toast and returns its id. */
  show: (options: ToastOptions) => string
  success: (title: string, extras?: ToastExtras) => string
  error: (title: string, extras?: ToastExtras) => string
  /** XP or reward moment, in gold: `toast.xp('Task completed', { description: '+15 XP' })`. */
  xp: (title: string, extras?: ToastExtras) => string
  dismiss: (id: string) => void
  dismissAll: () => void
}

export const ToastContext = createContext<ToastApi | null>(null)

/** Show toasts from anywhere under <ToastProvider>. The returned API is stable across renders. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast must be used inside <ToastProvider>')
  return api
}
