/**
 * Typed element lookup without non-null assertions or casts. A missing or wrong-typed element is a
 * bug in the page, so it throws: `byId('btn-back', HTMLButtonElement)`.
 */
export function byId<T extends HTMLElement>(id: string, type: abstract new () => T): T {
  const el = document.getElementById(id)
  if (!(el instanceof type)) throw new Error(`Forge Focus: #${id} is missing from the page`)
  return el
}
