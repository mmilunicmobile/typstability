import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasPage } from './CanvasPage'
import type { EditorPage, Selection, Tool } from '../types'

const scene = vi.hoisted(() => ({ stage: {} as Record<string, any>, rectangles: [] as Record<string, any>[], transformers: [] as Record<string, any>[] }))
vi.mock('react-konva', () => ({
  Stage: (props: any) => { scene.stage = props; return <div>{props.children}</div> },
  Layer: (props: any) => <div>{props.children}</div>,
  Group: (props: any) => <div>{props.children}</div>,
  Rect: (props: any) => { scene.rectangles.push(props); return null },
  Transformer: (props: any) => { scene.transformers.push(props); return null },
  Text: (props: any) => <span>{props.text}</span>,
  Circle: () => null, Image: () => null, Line: () => null,
}))
vi.mock('../lib/pdf', () => ({ renderPdfPage: vi.fn() }))

const page: EditorPage = { id: 'page', sourceIndex: null, width: 612, height: 792, elements: [
  { id: 'empty', kind: 'typst', x: 50, y: 50, width: 150, height: 80, source: '', previewSvg: '<svg />' },
] }
const onSelect = vi.fn()
const onCreateTypst = vi.fn()
function mount(tool: Tool = 'typst', selection: Selection = null) {
  return render(<CanvasPage page={page} pageNumber={1} pdf={null} zoom={2} tool={tool} selection={selection}
    penColor="#000000" penRadius={2} eraserRadius={10} onActivate={vi.fn()} onSelect={onSelect}
    onChangeElement={vi.fn()} onResizeEnd={vi.fn()} onDropElement={vi.fn()} onDragPreview={vi.fn()}
    onAddStroke={vi.fn()} onEraseAt={vi.fn()} onCreateTypst={onCreateTypst} />)
}
function pointer(handler: string, x: number, y: number) {
  const stage = { getPointerPosition: () => ({ x: x * 2, y: y * 2 }), getStage() { return this } }
  act(() => scene.stage[handler]({ target: stage, evt: { buttons: 1 } }))
}
beforeEach(() => { scene.rectangles = []; scene.transformers = []; vi.clearAllMocks() })
afterEach(cleanup)

describe('text box canvas interactions', () => {
  it('keeps empty boxes discoverable after their blank preview compiles', () => {
    mount('select')
    expect(screen.getByText('Click to edit text')).toBeInTheDocument()
    const hitBox = scene.rectangles.find((rect) => rect.onClick)
    expect(hitBox).toMatchObject({ listening: true, dash: [4, 4], stroke: '#b7b5ad' })
    act(() => hitBox?.onClick())
    expect(onSelect).toHaveBeenCalledWith('empty')
  })

  it('a Text-tool click opens an existing empty box without creating another', () => {
    mount()
    pointer('onPointerDown', 80, 80)
    pointer('onPointerUp', 80, 80)
    expect(onSelect).toHaveBeenCalledWith('empty')
    expect(onCreateTypst).not.toHaveBeenCalled()
  })

  it('can start or finish a new box over an existing empty box', () => {
    mount()
    expect(scene.rectangles.find((rect) => rect.onClick)?.listening).toBe(false)
    pointer('onPointerDown', 10, 10)
    pointer('onPointerMove', 90, 90)
    pointer('onPointerUp', 90, 90)
    expect(onCreateTypst).toHaveBeenLastCalledWith({ x: 10, y: 10, width: 80, height: 80 })
    pointer('onPointerDown', 90, 90)
    pointer('onPointerMove', 220, 190)
    pointer('onPointerUp', 220, 190)
    expect(onCreateTypst).toHaveBeenLastCalledWith({ x: 90, y: 90, width: 130, height: 100 })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('uses Konva free corner resizing and its Shift-to-constrain behavior', () => {
    mount('select', { pageId: 'page', elementId: 'empty' })
    expect(scene.transformers.at(-1)).toMatchObject({ keepRatio: false, shiftBehavior: 'default', flipEnabled: false })
    const bounds = scene.transformers.at(-1)?.boundBoxFunc
    const previous = { width: 150, height: 80 }
    expect(bounds(previous, { width: 250, height: 30 })).toEqual({ width: 250, height: 30 })
    expect(bounds(previous, { width: 0.1, height: 30 })).toBe(previous)
  })
})
