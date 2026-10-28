import type { EditorDocument, PageElement } from '../types'
import { isValidImageCrop } from './image-crop'

const FORMAT = 'typstability'
function encode(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return btoa(binary)
}
function decode(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Invalid embedded file data.')
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid project structure.')
  return value as Record<string, unknown>
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid project text.')
  return value
}
function number(value: unknown, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) throw new Error('Invalid project dimensions or coordinates.')
  return value
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Invalid project list.')
  return value
}
function editableElement(element: PageElement) {
  if (element.kind !== 'typst') return element
  const { id, kind, x, y, width, height, source, topInset, pageFill } = element
  return { id, kind, x, y, width, height, source, topInset, pageFill }
}
export function serializeProject(document: EditorDocument): string {
  return JSON.stringify({ format: FORMAT, version: 1, document: {
    ...document,
    originalPdf: document.originalPdf ? encode(document.originalPdf) : null,
    pages: document.pages.map((page) => ({ ...page, elements: page.elements.map(editableElement) })),
  } })
}
export function parseProject(text: string): EditorDocument {
  const file = object(JSON.parse(text))
  if (file.format !== FORMAT) throw new Error('This is not a Typstability project file.')
  if (file.version !== 1) throw new Error('This project version is not supported. Update Typstability to open it.')
  const doc = object(file.document)
  const originalPdf = doc.originalPdf === null ? null : decode(doc.originalPdf)
  const ids = new Set<string>()
  const id = (value: unknown) => {
    const result = string(value)
    if (!result || ids.has(result)) throw new Error('Project contains missing or duplicate IDs.')
    ids.add(result)
    return result
  }
  const pages = array(doc.pages).map((value) => {
    const page = object(value)
    const sourceIndex = page.sourceIndex === null ? null : number(page.sourceIndex)
    if (sourceIndex !== null && (!originalPdf || !Number.isInteger(sourceIndex) || sourceIndex < 0)) throw new Error('Invalid PDF page reference.')
    return {
      id: id(page.id), sourceIndex, width: number(page.width, true), height: number(page.height, true),
      elements: array(page.elements).map((value): PageElement => {
        const e = object(value)
        const elementId = id(e.id)
        if (e.kind === 'stroke') {
          const color = string(e.color)
          if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Invalid stroke color.')
          return { id: elementId, kind: 'stroke', color, radius: number(e.radius, true), points: array(e.points).map((p) => { const point = object(p); return { x: number(point.x), y: number(point.y) } }) }
        }
        const box = { id: elementId, x: number(e.x), y: number(e.y), width: number(e.width, true), height: number(e.height, true) }
        if (e.kind === 'typst') {
          const topInset = e.topInset === undefined ? undefined : number(e.topInset)
          if (topInset !== undefined && topInset < 0) throw new Error('Invalid Typst top inset.')
          const pageFill = e.pageFill === undefined ? undefined : string(e.pageFill)
          return { ...box, kind: 'typst', source: string(e.source),
            ...(topInset === undefined ? {} : { topInset }),
            ...(pageFill === undefined ? {} : { pageFill }) }
        }
        if (e.kind === 'image') {
          if (e.mime !== 'image/png' && e.mime !== 'image/jpeg') throw new Error('Unsupported image type.')
          const dataUrl = string(e.dataUrl)
          const prefix = `data:${e.mime};base64,`
          if (!dataUrl.startsWith(prefix) || !decode(dataUrl.slice(prefix.length)).length) throw new Error('Invalid embedded image.')
          if (e.crop !== undefined && !isValidImageCrop(e.crop)) throw new Error('Invalid image crop.')
          return { ...box, kind: 'image', mime: e.mime, dataUrl,
            ...(e.crop === undefined ? {} : { crop: e.crop }) }
        }
        throw new Error('Unsupported project element.')
      }),
    }
  })
  if (!pages.length) throw new Error('Project must contain at least one page.')
  return { name: string(doc.name).trim() || 'Untitled', prelude: string(doc.prelude), originalPdf, pages, updatedAt: Date.now() }
}
export function downloadProject(document: EditorDocument) {
  const url = URL.createObjectURL(new Blob([serializeProject(document)], { type: 'application/json' }))
  const link = globalThis.document.createElement('a')
  link.href = url
  link.download = `${document.name.replace(/[\\/:*?"<>|]/g, '_') || 'Untitled'}.typstability`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
