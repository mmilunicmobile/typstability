import type { Point, StrokeElement } from '../types'

function distanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const projection = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy),
  ))
  const nearestX = start.x + projection * dx
  const nearestY = start.y + projection * dy
  return Math.hypot(point.x - nearestX, point.y - nearestY)
}

export function strokeTouchesPoint(stroke: StrokeElement, point: Point, eraserRadius: number) {
  const threshold = stroke.radius + eraserRadius
  if (stroke.points.length === 1) {
    return Math.hypot(stroke.points[0].x - point.x, stroke.points[0].y - point.y) <= threshold
  }
  for (let index = 1; index < stroke.points.length; index += 1) {
    if (distanceToSegment(point, stroke.points[index - 1], stroke.points[index]) <= threshold) {
      return true
    }
  }
  return false
}
