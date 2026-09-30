import { useCallback, useEffect, useState } from 'react'
import { useShortcutHandler } from '@/app/shortcuts'
import { useTimer } from '@/features/focus'
import { ParkingNotice } from './ParkingNotice'
import { ParkingPopover } from './ParkingPopover'
import { closeParking, openParking, useParkingOpen } from './store'

/** How long the "Parked" confirmation stays. */
const NOTICE_MS = 2600

/**
 * Slot `global.overlays`: owns the parking popover for the whole app. It binds `p` (on the Focus page, in
 * full-screen focus, and anywhere while a focus session runs), draws the popover while it is open and
 * the short "Parked" confirmation after a save. Renders nothing otherwise.
 */
export function ParkingHost() {
  const open = useParkingOpen()
  const timer = useTimer()
  const [notice, setNotice] = useState<HTMLElement | null>(null)

  // Only a focus session collects thoughts; a break, or no session at all, parks them on no session.
  const sessionId = timer.session?.kind === 'focus' ? timer.session.id : null

  useShortcutHandler('parking.open', openParking)
  useShortcutHandler('parking.open.fullscreen', openParking)
  useShortcutHandler('parking.open.session', openParking, sessionId !== null)

  const parked = useCallback((host: HTMLElement) => setNotice(host), [])
  useEffect(() => {
    if (notice === null) return undefined
    const timeout = setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(timeout)
  }, [notice])

  return (
    <>
      {open ? (
        <ParkingPopover sessionId={sessionId} onClose={closeParking} onParked={parked} />
      ) : null}
      {notice !== null && !open ? <ParkingNotice host={notice} /> : null}
    </>
  )
}
