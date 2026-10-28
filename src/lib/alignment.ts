import type { Box, EditorPage, ImageElement, TypstElement } from '../types'

export const GRID_SPACING = 12
export type AlignmentGuides = { x?: number; y?: number }

function snapAxis(position: number, size: number, limit: number, targets: number[], zoom: number) {
  let offset = Math.round(position / GRID_SPACING) * GRID_SPACING - position
  let guide: number | undefined
  const threshold = 6 / Math.max(0.1, zoom)
  for (const target of targets) {
    for (const edge of [position, position + size / 2, position + size]) {
      const candidate = target - edge
      if (Math.abs(candidate) <= threshold && Math.abs(candidate) <= Math.abs(offset)) {
        offset = candidate
        guide = target
      }
    }
  }
  const raw = position + offset
  const value = Math.max(0, Math.min(Math.max(0, limit - size), raw))
  return { value, guide: value === raw ? guide : undefined }
}

export function snapBoxPosition<T extends Box>(box: T, page: Pick<EditorPage, 'width' | 'height' | 'elements'>,
  zoom: number, excludeId?: string): { box: T; guides: AlignmentGuides } {
  const others = page.elements.filter((element): element is ImageElement | TypstElement => element.kind !== 'stroke' && element.id !== excludeId)
  const xs = [0, page.width / 2, page.width, ...others.flatMap((element) => [element.x, element.x + element.width / 2, element.x + element.width])]
  const ys = [0, page.height / 2, page.height, ...others.flatMap((element) => [element.y, element.y + element.height / 2, element.y + element.height])]
  const x = snapAxis(box.x, box.width, page.width, xs, zoom)
  const y = snapAxis(box.y, box.height, page.height, ys, zoom)
  return { box: { ...box, x: x.value, y: y.value }, guides: { x: x.guide, y: y.guide } }
}
