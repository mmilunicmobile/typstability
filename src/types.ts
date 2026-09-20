export type Tool = 'select' | 'typst' | 'pen' | 'eraser'

export type Point = { x: number; y: number }

export type ImageElement = {
  id: string
  kind: 'image'
  x: number
  y: number
  width: number
  height: number
  dataUrl: string
  mime: 'image/png' | 'image/jpeg'
}

export type TypstElement = {
  id: string
  kind: 'typst'
  x: number
  y: number
  width: number
  height: number
  source: string
  previewSvg?: string
  previewWidth?: number
  previewHeight?: number
  previewPrelude?: string
  error?: string
}

export type StrokeElement = {
  id: string
  kind: 'stroke'
  points: Point[]
  radius: number
  color: string
}

export type PageElement = ImageElement | TypstElement | StrokeElement

export type EditorPage = {
  id: string
  sourceIndex: number | null
  width: number
  height: number
  elements: PageElement[]
}

export type EditorDocument = {
  name: string
  prelude: string
  originalPdf: Uint8Array | null
  pages: EditorPage[]
  updatedAt: number
}

export type Selection = { pageId: string; elementId: string } | null

export type Box = { x: number; y: number; width: number; height: number }

export type ObjectDrop = {
  clientX: number
  clientY: number
  grabOffset: Point
}

export type ObjectDragPreview = ObjectDrop & {
  element: ImageElement | TypstElement
}

export const LETTER_PAGE = { width: 612, height: 792 }

export const uid = () => crypto.randomUUID()
