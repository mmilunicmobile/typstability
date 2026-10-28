import { describe, expect, it } from 'vitest'
import { snapBoxPosition } from './alignment'
import type { EditorPage } from '../types'

const page: EditorPage = { id: 'page', sourceIndex: null, width: 612, height: 792, elements: [] }

describe('alignment helpers', () => {
  it('snaps to the 12 pt grid', () => {
    expect(snapBoxPosition({ x: 25, y: 37, width: 120, height: 50 }, page, 1).box)
      .toMatchObject({ x: 24, y: 36 })
  })
  it('aligns edges and centers with other objects and reports guides', () => {
    const target = { id: 'target', kind: 'typst' as const, x: 100, y: 120, width: 80, height: 40, source: '' }
    const result = snapBoxPosition({ x: 102, y: 122, width: 50, height: 30 }, { ...page, elements: [target] }, 1)
    expect(result.box).toMatchObject({ x: 100, y: 120 })
    expect(result.guides).toEqual({ x: 100, y: 120 })
    const centered = snapBoxPosition({ x: 115.5, y: 125.5, width: 50, height: 30 }, { ...page, elements: [target] }, 1)
    expect(centered.box).toMatchObject({ x: 115, y: 125 })
    expect(centered.guides).toEqual({ x: 140, y: 140 })
  })
  it('excludes the moving object and keeps the magnetic threshold consistent on screen', () => {
    const target = { id: 'target', kind: 'image' as const, x: 102, y: 122, width: 50, height: 30, mime: 'image/png' as const, dataUrl: '' }
    expect(snapBoxPosition(target, { ...page, elements: [target] }, 1, target.id).box)
      .toMatchObject({ x: 108, y: 120 })
    const neighbor = { ...target, x: 100, y: 120 }
    expect(snapBoxPosition({ x: 102, y: 80, width: 50, height: 30 }, { ...page, elements: [neighbor] }, 5).box.x).toBe(108)
  })
  it('aligns to page centers and clamps positions at the page bounds', () => {
    const result = snapBoxPosition({ x: 256.5, y: 371.5, width: 100, height: 50 }, page, 1)
    expect(result.box).toMatchObject({ x: 256, y: 371 })
    expect(result.guides).toEqual({ x: 306, y: 396 })
    expect(snapBoxPosition({ x: -10, y: 800, width: 100, height: 50 }, page, 1).box).toMatchObject({ x: 0, y: 742 })
  })
})
