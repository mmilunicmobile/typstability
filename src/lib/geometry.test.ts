import { describe, expect, it } from 'vitest'
import { strokeTouchesPoint } from './geometry'
import type { StrokeElement } from '../types'

const stroke: StrokeElement = {
  id: 'stroke',
  kind: 'stroke',
  color: '#000000',
  radius: 2,
  points: [{ x: 10, y: 10 }, { x: 100, y: 10 }],
}

describe('strokeTouchesPoint', () => {
  it('detects a point touching the middle of a segment', () => {
    expect(strokeTouchesPoint(stroke, { x: 55, y: 14 }, 3)).toBe(true)
  })

  it('does not erase a distant stroke', () => {
    expect(strokeTouchesPoint(stroke, { x: 55, y: 30 }, 3)).toBe(false)
  })
})
