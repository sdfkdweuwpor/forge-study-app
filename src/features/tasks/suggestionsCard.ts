/**
 * Lets the "Accept suggested times" command find the suggestions card. The card exists only on Inbox,
 * Upcoming and Today, so away from those the command has to take the person to it first. This module is
 * the small handshake: the card says when it is on screen, the command asks it to show itself, and a
 * request made before the card has mounted (the page is still loading) is kept for a few seconds.
 */

const REQUEST_TTL_MS = 5000
const OPEN_EVENT = 'forge:suggestions-card:open'

let mounted = 0
let requestedAt: number | null = null

/** The card calls this while it is mounted. Returns the cleanup. */
export function registerSuggestionsCard(): () => void {
  mounted += 1
  return () => {
    mounted -= 1
  }
}

export const isSuggestionsCardMounted = (): boolean => mounted > 0

/**
 * Asks the card to scroll into view and take focus (or to say there is nothing to schedule). When no
 * card is mounted yet, `goToCard` runs (it navigates to Upcoming) and the request waits for the card.
 */
export function openSuggestionsCard(goToCard: () => void): void {
  if (mounted > 0) {
    window.dispatchEvent(new Event(OPEN_EVENT))
    return
  }
  requestedAt = Date.now()
  goToCard()
}

/** Whether a request is waiting for a card that has just mounted (and clears it). */
export function takePendingRequest(): boolean {
  const wanted = requestedAt !== null && Date.now() - requestedAt < REQUEST_TTL_MS
  requestedAt = null
  return wanted
}

/** Subscribes the mounted card to requests made while it is already on screen. */
export function onSuggestionsRequest(handler: () => void): () => void {
  window.addEventListener(OPEN_EVENT, handler)
  return () => window.removeEventListener(OPEN_EVENT, handler)
}
