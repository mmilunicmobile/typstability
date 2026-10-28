import { describe, expect, it } from 'vitest'
import { nudgeElement } from './nudge'
import type { TypstElement } from '../types'

const box: TypstElement = { id: 'box', kind: 'typst', x: 10, y: 20, width: 100, height: 50, source: 'Hello' }
const page = { width: 200, height: 100 }
describe('object nudging', () => {
  it('moves by one point or ten with Shift', () => {
    expect(nudgeElement(box, page, 'ArrowRight', false)).toMatchObject({ x: 11, y: 20 })
    expect(nudgeElement(box, page, 'ArrowUp', true)).toMatchObject({ x: 10, y: 10 })
    expect(nudgeElement(box, page, 'ArrowDown', true)).toMatchObject({ x: 10, y: 30 })
  })
  it('stops at page edges and does not create changes at an edge', () => {
    const edge = { ...box, x: 100, y: 0 }
    expect(nudgeElement(edge, page, 'ArrowRight', true)).toBe(edge)
    expect(nudgeElement(edge, page, 'ArrowUp', false)).toBe(edge)
    expect(nudgeElement({ ...box, x: 5 }, page, 'ArrowLeft', true)).toMatchObject({ x: 0 })
    expect(nudgeElement({ ...box, width: 300 }, page, 'ArrowRight', true)).toMatchObject({ x: 0 })
    expect(nudgeElement(box, page, 'Enter', false)).toBeNull()
  })
})
