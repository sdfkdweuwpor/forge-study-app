/**
 * Pointer sensors for board cards. A card is one big drag surface, but a few things inside it are
 * controls in their own right: the inline title editor (selecting text must not move the card), the
 * checkbox, the … menu and everything it opens. A press that starts on one of those never starts a
 * drag. The card's own surface is exempt even though it is built from buttons: the stretched
 * "open" button behind the content, the grip, and the title text (`data-drag-through`), because
 * dragging by those is the point.
 */
import {
  MouseSensor,
  TouchSensor,
  type MouseSensorOptions,
  type TouchSensorOptions,
} from '@dnd-kit/core'
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react'

const CONTROLS = 'textarea, input, select, button, [contenteditable]'

/**
 * Whether a press should be left to the control under the pointer. `currentTarget` is the card;
 * events from a menu or picker (rendered in a portal, but bubbling through React to the card) are
 * not the card's to drag either.
 */
export function pressIsOnControl(target: EventTarget | null, card: EventTarget | null): boolean {
  if (!(target instanceof Element) || !(card instanceof Element)) return false
  if (!card.contains(target)) return true
  const control = target.closest(CONTROLS)
  return control !== null && card.contains(control) && !control.hasAttribute('data-drag-through')
}

const mouse = MouseSensor.activators[0]
const touch = TouchSensor.activators[0]

export class CardMouseSensor extends MouseSensor {
  static override activators = [
    {
      eventName: 'onMouseDown' as const,
      handler: (event: ReactMouseEvent, options: MouseSensorOptions): boolean =>
        !pressIsOnControl(event.target, event.currentTarget) &&
        (mouse?.handler(event, options) ?? false),
    },
  ]
}

export class CardTouchSensor extends TouchSensor {
  static override activators = [
    {
      eventName: 'onTouchStart' as const,
      handler: (event: ReactTouchEvent, options: TouchSensorOptions): boolean =>
        !pressIsOnControl(event.target, event.currentTarget) &&
        (touch?.handler(event, options) ?? false),
    },
  ]
}
