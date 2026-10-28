import { describe, expect, it } from 'vitest'
import { parseProject, serializeProject } from './project-file'
import type { EditorDocument } from '../types'

const document: EditorDocument = {
  defaultTopInset: 7, name: 'Notes ∑', prelude: '#let title = "Hello"', originalPdf: new Uint8Array([0, 255, 128, 10]), updatedAt: 1,
  pages: [{ id: 'p', sourceIndex: 0, width: 612, height: 792, elements: [
    { id: 't', kind: 'typst', x: 10, y: 20, width: 100, height: 80, source: '$ x^2 $', topInset: 6, pageFill: 'rgb("#f5f0e6")', previewSvg: '<svg>cache</svg>' },
    { id: 'i', kind: 'image', x: 0, y: 0, width: 50, height: 50, mime: 'image/png', dataUrl: 'data:image/png;base64,AQID' },
    { id: 's', kind: 'stroke', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], color: '#123abc', radius: 2 },
  ] }, { id: 'blank', sourceIndex: null, width: 400, height: 600, elements: [] }],
}
describe('project files', () => {
  it('round trips all editable content and binary assets, excluding preview caches', () => {
    const serialized = serializeProject(document)
    expect(serialized).not.toContain('previewSvg')
    const result = parseProject(serialized)
    expect(result.originalPdf).toEqual(document.originalPdf)
    expect(result.prelude).toBe(document.prelude)
    expect(result.name).toBe(document.name)
    expect(result.defaultTopInset).toBe(7)
    expect(result.pages[0].elements[0]).toEqual({ id: 't', kind: 'typst', x: 10, y: 20, width: 100, height: 80, source: '$ x^2 $', topInset: 6, pageFill: 'rgb("#f5f0e6")' })
    expect(result.pages[0].elements.slice(1)).toEqual(document.pages[0].elements.slice(1))
    expect(result.pages[1]).toEqual(document.pages[1])
  })
  it('supports projects with no original PDF', () => {
    expect(parseProject(serializeProject({ ...document, originalPdf: null, pages: [document.pages[1]] })).originalPdf).toBeNull()
  })
  it.each([
    (f: any) => { f.version = 2 },
    (f: any) => { f.document.defaultTopInset = -1 },
    (f: any) => { f.document.defaultTopInset = 201 },
    (f: any) => { f.document.defaultTopInset = '7' },
    (f: any) => { f.document.pages[0].width = -1 },
    (f: any) => { f.document.pages[0].elements[1].id = 't' },
    (f: any) => { f.document.pages[0].elements[1].dataUrl = 'https://example.com/pixel.png' },
    (f: any) => { f.document.originalPdf = 'invalid!' },
    (f: any) => { f.document.pages[0].sourceIndex = -1 },
    (f: any) => { f.document.pages = [] },
    (f: any) => { f.document.pages[0].elements[0].kind = 'script' },
    (f: any) => { f.document.pages[0].elements[0].topInset = -1 },
    (f: any) => { f.document.pages[0].elements[0].pageFill = 3 },
  ])('rejects malformed or unsupported input', (mutate) => {
    const file = JSON.parse(serializeProject(document))
    mutate(file)
    expect(() => parseProject(JSON.stringify(file))).toThrow()
  })
})
