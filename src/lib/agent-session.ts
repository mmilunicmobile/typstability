import type { EditorDocument, EditorPage, PageElement, TypstElement } from '../types'
import { LETTER_PAGE, uid } from '../types'
import { DEFAULT_TYPST_TOP_INSET } from '../typst/source'

/** Agent snapshots deliberately omit binary assets and generated preview caches. */
export function agentDocument(document: EditorDocument) {
  return {
    name: document.name,
    prelude: document.prelude,
    hasOriginalPdf: document.originalPdf !== null,
    pages: document.pages.map((page) => ({
      ...page,
      elements: page.elements.map((element) => {
        if (element.kind === 'stroke') return { ...element, points: element.points.map((point) => ({ ...point })) }
        const { id, kind, x, y, width, height } = element
        if (element.kind === 'image') return { id, kind, x, y, width, height, mime: element.mime }
        return { id, kind, x, y, width, height, source: element.source,
          topInset: element.topInset ?? DEFAULT_TYPST_TOP_INSET, pageFill: element.pageFill ?? '' }
      }),
    })),
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.')
  return value as Record<string, unknown>
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`)
  return value
}
function number(value: unknown, field: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) {
    throw new Error(`${field} must be a finite ${positive ? 'positive ' : ''}number.`)
  }
  return value
}
function pageFor(document: EditorDocument, pageId: unknown): EditorPage {
  const page = document.pages.find((candidate) => candidate.id === text(pageId, 'pageId'))
  if (!page) throw new Error('Page not found. Read the session again for current IDs.')
  return page
}
function geometry(input: Record<string, unknown>) {
  const box: Partial<Pick<TypstElement, 'x' | 'y' | 'width' | 'height'>> = {}
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    if (input[field] !== undefined) box[field] = number(input[field], field, field === 'width' || field === 'height')
  }
  return box
}
function textProperties(input: Record<string, unknown>) {
  const result: Partial<Pick<TypstElement, 'source' | 'topInset' | 'pageFill'>> = {}
  if (input.source !== undefined) result.source = text(input.source, 'source')
  if (input.pageFill !== undefined) result.pageFill = text(input.pageFill, 'pageFill')
  if (input.topInset !== undefined) {
    result.topInset = number(input.topInset, 'topInset')
    if (result.topInset < 0 || result.topInset > 200) throw new Error('topInset must be between 0 and 200 pt.')
  }
  return result
}

/** Validate the whole batch before the caller commits one undoable document update. */
export function applyAgentEdits(document: EditorDocument, operations: unknown): EditorDocument {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 100) {
    throw new Error('Provide between 1 and 100 operations.')
  }
  const next: EditorDocument = { ...document, pages: document.pages.map((page) => ({ ...page, elements: [...page.elements] })) }
  for (const raw of operations) {
    const op = object(raw)
    switch (op.action) {
      case 'set_document': {
        if (op.name === undefined && op.prelude === undefined) throw new Error('Provide name or prelude.')
        if (op.name !== undefined) next.name = text(op.name, 'name').trim() || 'Untitled'
        if (op.prelude !== undefined) next.prelude = text(op.prelude, 'prelude')
        break
      }
      case 'add_text_box': {
        const page = pageFor(next, op.pageId)
        page.elements.push({ id: uid(), kind: 'typst', x: number(op.x, 'x'), y: number(op.y, 'y'),
          width: number(op.width, 'width', true), height: number(op.height, 'height', true),
          source: '', topInset: DEFAULT_TYPST_TOP_INSET, ...textProperties(op) })
        break
      }
      case 'update_element': {
        const page = pageFor(next, op.pageId)
        const index = page.elements.findIndex((element) => element.id === text(op.elementId, 'elementId'))
        const element = page.elements[index]
        if (!element) throw new Error('Element not found. Read the session again for current IDs.')
        if (element.kind === 'stroke') throw new Error('Pen strokes can be deleted; this tool resizes text boxes and images.')
        if (element.kind !== 'typst' && (op.source !== undefined || op.topInset !== undefined || op.pageFill !== undefined)) {
          throw new Error('Only text boxes have source, topInset, and pageFill.')
        }
        const changes = { ...geometry(op), ...(element.kind === 'typst' ? textProperties(op) : {}) }
        if (!Object.keys(changes).length) throw new Error('Provide source, geometry, topInset, or pageFill to update.')
        page.elements[index] = { ...element, ...changes } as PageElement
        break
      }
      case 'delete_element': {
        const page = pageFor(next, op.pageId)
        const id = text(op.elementId, 'elementId')
        if (!page.elements.some((element) => element.id === id)) throw new Error('Element not found.')
        page.elements = page.elements.filter((element) => element.id !== id)
        break
      }
      case 'add_page': {
        const after = op.afterPageId === undefined ? next.pages.length - 1 : next.pages.indexOf(pageFor(next, op.afterPageId))
        next.pages.splice(after + 1, 0, { id: uid(), sourceIndex: null,
          width: op.width === undefined ? LETTER_PAGE.width : number(op.width, 'width', true),
          height: op.height === undefined ? LETTER_PAGE.height : number(op.height, 'height', true), elements: [] })
        break
      }
      case 'delete_page': {
        const page = pageFor(next, op.pageId)
        if (next.pages.length <= 1) throw new Error('Keep at least one page in the document.')
        next.pages = next.pages.filter((candidate) => candidate !== page)
        break
      }
      case 'reorder_page': {
        const page = pageFor(next, op.pageId)
        const before = op.beforePageId === null ? null : pageFor(next, op.beforePageId)
        if (before === page) break
        next.pages = next.pages.filter((candidate) => candidate !== page)
        next.pages.splice(before ? next.pages.indexOf(before) : next.pages.length, 0, page)
        break
      }
      default: throw new Error('Unknown action. Use the edit tool schema to choose an action.')
    }
  }
  return next
}

const stringSchema = { type: 'string' }
const sizeSchema = { type: 'number', exclusiveMinimum: 0 }
const boxProperties = { x: { type: 'number' }, y: { type: 'number' }, width: sizeSchema, height: sizeSchema }
const sourceProperties = { source: stringSchema, topInset: { type: 'number', minimum: 0, maximum: 200 }, pageFill: stringSchema }
function operation(action: string, properties: Record<string, unknown>, required: string[]) {
  return { type: 'object', properties: { action: { const: action }, ...properties }, required: ['action', ...required], additionalProperties: false }
}
export const agentEditSchema = {
  type: 'object',
  properties: {
    revision: { type: 'integer', minimum: 0, description: 'Revision from the latest read_session result; stale edits are rejected.' },
    operations: { type: 'array', minItems: 1, maxItems: 100, items: { oneOf: [
      operation('set_document', { name: stringSchema, prelude: stringSchema }, []),
      operation('add_text_box', { pageId: stringSchema, ...boxProperties, ...sourceProperties }, ['pageId', 'x', 'y', 'width', 'height']),
      operation('update_element', { pageId: stringSchema, elementId: stringSchema, ...boxProperties, ...sourceProperties }, ['pageId', 'elementId']),
      operation('delete_element', { pageId: stringSchema, elementId: stringSchema }, ['pageId', 'elementId']),
      operation('add_page', { afterPageId: stringSchema, width: sizeSchema, height: sizeSchema }, []),
      operation('delete_page', { pageId: stringSchema }, ['pageId']),
      operation('reorder_page', { pageId: stringSchema, beforePageId: { type: ['string', 'null'] } }, ['pageId', 'beforePageId']),
    ] } },
  },
  required: ['revision', 'operations'],
  additionalProperties: false,
}
