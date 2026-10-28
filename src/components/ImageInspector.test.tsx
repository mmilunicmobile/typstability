import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImageElement } from '../types'
import { ImageInspector } from './ImageInspector'

const image: ImageElement = { id: 'image', kind: 'image', x: 20, y: 30, width: 200, height: 100,
  mime: 'image/png', dataUrl: 'data:image/png;base64,AQID' }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('image crop editor', () => {
  it('draws a crop over the original image and applies it as one change', () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const onChange = vi.fn()
    render(<ImageInspector element={image} onChange={onChange} onClose={vi.fn()} onDelete={vi.fn()} />)
    const preview = screen.getByLabelText('Crop selection preview')
    preview.setPointerCapture = vi.fn()
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 200, height: 100 } as DOMRect)
    fireEvent.pointerDown(preview, { button: 0, clientX: 60, clientY: 30 })
    fireEvent.pointerMove(preview, { clientX: 160, clientY: 90 })
    fireEvent.pointerUp(preview)
    expect(screen.getByLabelText('Crop left')).toHaveValue(25)
    expect(screen.getByLabelText('Crop top')).toHaveValue(10)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Apply crop' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...image, x: 70, y: 40, width: 100, height: 60,
      crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.6 } })
  })

  it('prevents empty crops when numeric edge insets overlap', () => {
    const onChange = vi.fn()
    render(<ImageInspector element={image} onChange={onChange} onClose={vi.fn()} onDelete={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Crop left'), { target: { value: '70' } })
    fireEvent.change(screen.getByLabelText('Crop right'), { target: { value: '80' } })
    expect(screen.getByLabelText('Crop right')).toHaveValue(29)
    fireEvent.click(screen.getByRole('button', { name: 'Apply crop' }))
    expect(onChange.mock.calls[0][0].width).toBeCloseTo(2)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByLabelText('Crop right')).toHaveValue(0)
    expect(screen.getByRole('button', { name: 'Apply crop' })).toBeDisabled()
  })
})
