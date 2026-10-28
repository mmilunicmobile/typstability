import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PageThumbnail } from './PageThumbnail'
import type { EditorPage } from '../types'

vi.mock('../lib/pdf', () => ({ renderPdfPage: vi.fn() }))

const page: EditorPage = {
  id: 'page-1', sourceIndex: null, width: 200, height: 300, elements: [],
}

describe('PageThumbnail', () => {
  it('shows images, Typst previews, and strokes over a blank page and updates with edits', () => {
    const { container, rerender } = render(<PageThumbnail page={page} pdf={null} />)
    expect(container.querySelector('.thumbnail-object')).toBeNull()

    rerender(<PageThumbnail pdf={null} page={{ ...page, elements: [
      { id: 'image', kind: 'image', x: 20, y: 30, width: 100, height: 90,
        dataUrl: 'data:image/png;base64,AA==', mime: 'image/png' },
      { id: 'typst', kind: 'typst', x: 40, y: 50, width: 120, height: 100,
        source: 'Hello', previewSvg: '<svg xmlns="http://www.w3.org/2000/svg" />' },
      { id: 'stroke', kind: 'stroke', points: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
        radius: 2, color: '#ff0000' },
    ] }} />)

    const objects = container.querySelectorAll<HTMLElement>('.thumbnail-object')
    expect(objects).toHaveLength(2)
    expect(objects[0]).toHaveStyle({ left: '10%', top: '10%', width: '50%', height: '30%' })
    expect(objects[0].querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AA==')
    expect(objects[1].querySelector('img')?.getAttribute('src')).toContain('data:image/svg+xml')
    expect(container.querySelector('polyline')).toHaveAttribute('stroke', '#ff0000')

    rerender(<PageThumbnail page={page} pdf={null} />)
    expect(container.querySelector('.thumbnail-object')).toBeNull()
    expect(container.querySelector('polyline')).toBeNull()
  })
  it('clips cropped artwork to its visible frame', () => {
    const { container } = render(<PageThumbnail pdf={null} page={{ ...page, elements: [
      { id: 'image', kind: 'image', x: 20, y: 30, width: 100, height: 90,
        dataUrl: 'data:image/png;base64,AA==', mime: 'image/png', crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } },
    ] }} />)
    expect(container.querySelector('.thumbnail-object img')).toHaveStyle({ position: 'absolute', left: '-50%', top: '-50%', width: '200%', height: '200%' })
  })
})
