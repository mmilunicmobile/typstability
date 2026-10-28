import type { EditorPage, ImageElement, TypstElement } from '../types'

// Positions and steps use PDF points, independent of the current canvas zoom.
export function nudgeElement<T extends ImageElement | TypstElement>(element: T, page: Pick<EditorPage, 'width' | 'height'>, key: string, large: boolean): T | null {
  const directions: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  }
  const direction = directions[key]
  if (!direction) return null
  const step = large ? 10 : 1
  const x = Math.max(0, Math.min(Math.max(0, page.width - element.width), element.x + direction[0] * step))
  const y = Math.max(0, Math.min(Math.max(0, page.height - element.height), element.y + direction[1] * step))
  return x === element.x && y === element.y ? element : { ...element, x, y }
}
