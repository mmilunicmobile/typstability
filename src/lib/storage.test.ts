import { describe, expect, it } from 'vitest'
import { normalizeDocument } from './storage'
import type { EditorDocument } from '../types'

describe('normalizeDocument', () => {
  it('adds an empty prelude to sessions saved by older versions', () => {
    const legacy = {
      name: 'Legacy',
      originalPdf: null,
      pages: [],
      updatedAt: 1,
    } as unknown as EditorDocument

    expect(normalizeDocument(legacy).prelude).toBe('')
  })

  it('preserves an existing prelude', () => {
    const document: EditorDocument = {
      name: 'Current',
      prelude: '#let shared = 1',
      originalPdf: null,
      pages: [],
      updatedAt: 1,
    }

    expect(normalizeDocument(document).prelude).toBe('#let shared = 1')
  })
})
