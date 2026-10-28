import { describe, expect, it } from 'vitest'
import { agentDocument, applyAgentEdits } from './agent-session'
import type { EditorDocument } from '../types'

const document = (): EditorDocument => ({
  name: 'Example', prelude: '', updatedAt: 1, originalPdf: new Uint8Array([1, 2]),
  pages: [{ id: 'page', sourceIndex: 0, width: 612, height: 792, elements: [
    { id: 'text', kind: 'typst', x: 1, y: 2, width: 100, height: 50, source: 'Old', previewSvg: 'cached' },
    { id: 'image', kind: 'image', x: 3, y: 4, width: 80, height: 60, dataUrl: 'private image bytes', mime: 'image/png' },
  ] }],
})

describe('agent session edits', () => {
  it('reads source and layout without exporting binary assets or preview caches', () => {
    const snapshot = agentDocument(document())
    expect(snapshot).toMatchObject({ hasOriginalPdf: true, pages: [{ elements: [{ source: 'Old' }, { mime: 'image/png' }] }] })
    expect(JSON.stringify(snapshot)).not.toMatch(/cached|private image bytes|originalPdf/)
  })

  it('applies source, shared styles, geometry, and page changes without mutating the input', () => {
    const original = document()
    const next = applyAgentEdits(original, [
      { action: 'set_document', name: 'Edited', prelude: '#set text(size: 12pt)' },
      { action: 'update_element', pageId: 'page', elementId: 'text', source: 'New', width: 200, height: 70 },
      { action: 'update_element', pageId: 'page', elementId: 'image', x: 30 },
      { action: 'add_text_box', pageId: 'page', x: 40, y: 50, width: 100, height: 60, source: 'Added' },
      { action: 'add_page', afterPageId: 'page' },
    ])
    expect(next.name).toBe('Edited')
    expect(next.pages).toHaveLength(2)
    expect(next.pages[0].elements).toHaveLength(3)
    expect(next.pages[0].elements[0]).toMatchObject({ source: 'New', width: 200, height: 70 })
    expect(next.pages[0].elements[1]).toMatchObject({ x: 30, dataUrl: 'private image bytes' })
    expect(next.pages[0].elements[2]).toMatchObject({ source: 'Added', topInset: 4 })
    expect(original).toEqual(document())
    expect(next.originalPdf).toBe(original.originalPdf)
  })

  it('rejects an invalid batch atomically and rejects unsafe dimensions and missing IDs', () => {
    const original = document()
    expect(() => applyAgentEdits(original, [
      { action: 'set_document', name: 'Should not apply' },
      { action: 'update_element', pageId: 'page', elementId: 'text', width: -1 },
    ])).toThrow(/positive/)
    expect(original.name).toBe('Example')
    expect(() => applyAgentEdits(original, [{ action: 'update_element', pageId: 'page', elementId: 'text', x: NaN }])).toThrow(/finite/)
    expect(() => applyAgentEdits(original, [{ action: 'delete_element', pageId: 'page', elementId: 'missing' }])).toThrow(/not found/)
    expect(() => applyAgentEdits(original, [{ action: 'delete_page', pageId: 'page' }])).toThrow(/at least one/)
    expect(() => applyAgentEdits(original, [{ action: 'update_element', pageId: 'page', elementId: 'image', source: 'No' }])).toThrow(/Only text boxes/)
  })

  it('can reorder pages and remove elements and pages', () => {
    const original = document()
    original.pages.push({ id: 'second', sourceIndex: null, width: 600, height: 800, elements: [] })
    const next = applyAgentEdits(original, [
      { action: 'reorder_page', pageId: 'second', beforePageId: 'page' },
      { action: 'delete_element', pageId: 'page', elementId: 'image' },
    ])
    expect(next.pages.map((page) => page.id)).toEqual(['second', 'page'])
    expect(next.pages[1].elements.map((element) => element.id)).toEqual(['text'])
    expect(applyAgentEdits(next, [{ action: 'delete_page', pageId: 'second' }]).pages).toHaveLength(1)
  })
})
