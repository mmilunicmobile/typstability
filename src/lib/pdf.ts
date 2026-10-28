import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFStream, PDFString, decodePDFRawStream } from 'pdf-lib'
import type { PDFRef } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { EditorDocument, EditorPage, ImageElement, PageElement, StrokeElement, TypstElement } from '../types'
import { uid } from '../types'
import { compileTypstPdf } from '../typst/client'
import { DEFAULT_TYPST_TOP_INSET } from '../typst/source'
import { imageSourceBox, isValidImageCrop } from './image-crop'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

const appKey = PDFName.of('Typstability')
const annotationPrefix = 'Typstability:'
type SavedElement = ImageElement | StrokeElement | Omit<TypstElement, 'previewSvg' | 'previewSource' | 'previewWidth' | 'previewHeight' | 'previewPrelude' | 'previewTopInset' | 'previewPageFill' | 'error'>
type Manifest = { version: 1; prelude: string; pages: SavedElement[][] }

function validElement(value: unknown): value is SavedElement {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || !item.id || typeof item.kind !== 'string') return false
  if (item.kind === 'stroke') {
    return Array.isArray(item.points) && item.points.every((point) =>
      point && typeof point.x === 'number' && Number.isFinite(point.x)
      && typeof point.y === 'number' && Number.isFinite(point.y))
      && typeof item.radius === 'number' && Number.isFinite(item.radius)
      && typeof item.color === 'string'
  }
  if (!['typst', 'image'].includes(item.kind)
    || !['x', 'y', 'width', 'height'].every((key) => typeof item[key] === 'number' && Number.isFinite(item[key]))) return false
  return item.kind === 'typst' ? typeof item.source === 'string'
    && (item.topInset === undefined || (typeof item.topInset === 'number' && Number.isFinite(item.topInset) && item.topInset >= 0))
    && (item.pageFill === undefined || typeof item.pageFill === 'string')
    : typeof item.dataUrl === 'string' && ['image/png', 'image/jpeg'].includes(String(item.mime))
      && (item.crop === undefined || isValidImageCrop(item.crop))
}

function readManifest(pdf: PDFDocument): Manifest | null {
  try {
    const pieceInfo = pdf.catalog.lookupMaybe(PDFName.of('PieceInfo'), PDFDict)
    const appData = pieceInfo?.lookupMaybe(appKey, PDFDict)
    const privateData = appData?.lookupMaybe(PDFName.of('Private'), PDFDict)
    const stream = privateData?.lookupMaybe(PDFName.of('Manifest'), PDFStream)
    if (!(stream instanceof PDFRawStream)) return null
    const parsed: unknown = JSON.parse(new TextDecoder().decode(decodePDFRawStream(stream).decode()))
    if (!parsed || typeof parsed !== 'object') return null
    const manifest = parsed as Manifest
    if (manifest.version !== 1 || typeof manifest.prelude !== 'string'
      || !Array.isArray(manifest.pages)
      || !manifest.pages.every((page) => Array.isArray(page) && page.every(validElement))) return null
    return manifest
  } catch {
    return null
  }
}

function annotationId(pdf: PDFDocument, entry: Parameters<typeof pdf.context.lookup>[0]): string | null {
  try {
    const annotation = pdf.context.lookup(entry, PDFDict)
    const name = annotation.lookupMaybe(PDFName.of('NM'), PDFHexString)
    const id = name?.decodeText()
    return id?.startsWith(annotationPrefix) ? id.slice(annotationPrefix.length) : null
  } catch {
    return null
  }
}

export async function readPdf(file: File): Promise<EditorDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise
  const pages: EditorPage[] = []
  let sourceBytes: Uint8Array = bytes
  let prelude = ''
  let manifest: Manifest | null = null
  let editablePdf: PDFDocument | null = null
  try {
    editablePdf = await PDFDocument.load(bytes)
    manifest = readManifest(editablePdf)
  } catch {
    // Ordinary PDFs can still be viewed even if pdf-lib cannot inspect private data.
  }

  for (let index = 0; index < pdf.numPages; index += 1) {
    const page = await pdf.getPage(index + 1)
    const viewport = page.getViewport({ scale: 1 })
    const saved = manifest?.pages[index] ?? []
    const annotations = editablePdf?.getPage(index).node.Annots()
    const present = new Set<string>()
    if (manifest && editablePdf && annotations) {
      for (let item = 0; item < annotations.size(); item += 1) {
        const id = annotationId(editablePdf, annotations.get(item))
        if (id) present.add(id)
      }
    }
    pages.push({
      id: uid(),
      sourceIndex: index,
      width: viewport.width,
      height: viewport.height,
      elements: saved.filter((element) => present.has(element.id)) as PageElement[],
    })
  }

  if (manifest && editablePdf) {
    prelude = manifest.prelude
    const knownIds = new Set(manifest.pages.flat().map((element) => element.id))
    for (const page of editablePdf.getPages()) {
      const annotations = page.node.Annots()
      if (!annotations) continue
      for (let index = annotations.size() - 1; index >= 0; index -= 1) {
        const id = annotationId(editablePdf, annotations.get(index))
        if (id && knownIds.has(id)) annotations.remove(index)
      }
    }
    editablePdf.catalog.lookupMaybe(PDFName.of('PieceInfo'), PDFDict)?.delete(appKey)
    sourceBytes = await editablePdf.save()
  }

  return {
    name: file.name.replace(/\.pdf$/i, '') || 'Untitled',
    prelude,
    originalPdf: sourceBytes,
    pages,
    updatedAt: Date.now(),
  }
}

export async function createPdfProxy(bytes: Uint8Array) {
  return pdfjs.getDocument({ data: bytes.slice() }).promise
}

export async function renderPdfPage(
  proxy: pdfjs.PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number,
  signal?: AbortSignal,
) {
  const page = await proxy.getPage(pageNumber)
  if (signal?.aborted) return
  const viewport = page.getViewport({ scale })
  const outputScale = window.devicePixelRatio || 1
  // Draw offscreen so the previous image stays visible while resizing. Each
  // render owns its canvas; an older task cannot overwrite a newer zoom level.
  const buffer = document.createElement('canvas')
  const context = buffer.getContext('2d')
  if (!context) return
  buffer.width = Math.floor(viewport.width * outputScale)
  buffer.height = Math.floor(viewport.height * outputScale)
  const task = page.render({
    canvas: buffer,
    canvasContext: context,
    viewport,
    transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
  })
  const cancel = () => task.cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    await task.promise
    if (signal?.aborted) return
    canvas.width = buffer.width
    canvas.height = buffer.height
    canvas.getContext('2d')?.drawImage(buffer, 0, 0)
  } catch (error) {
    if (!signal?.aborted) throw error
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

function dataUrlBytes(dataUrl: string) {
  const encoded = dataUrl.split(',')[1]
  const binary = atob(encoded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function appearance(output: PDFDocument, width: number, height: number, commands: string, resources: { XObject?: { Artwork: PDFRef } } = {}) {
  const stream = output.context.flateStream(commands, {
    Type: 'XObject', Subtype: 'Form', FormType: 1,
    BBox: [0, 0, width, height], Resources: resources,
  })
  return output.context.register(stream)
}

function strokeBounds(stroke: StrokeElement) {
  const xs = stroke.points.map((point) => point.x)
  const ys = stroke.points.map((point) => point.y)
  const left = Math.min(...xs) - stroke.radius
  const top = Math.min(...ys) - stroke.radius
  return { x: left, y: top, width: Math.max(1, Math.max(...xs) - left + stroke.radius), height: Math.max(1, Math.max(...ys) - top + stroke.radius) }
}

function strokeAppearance(output: PDFDocument, stroke: StrokeElement) {
  const bounds = strokeBounds(stroke)
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(stroke.color.slice(offset, offset + 2), 16) / 255)
  const points = stroke.points.map((point) => `${point.x - bounds.x} ${bounds.height - (point.y - bounds.y)}`)
  const path = points.length === 1
    ? `${points[0]} m ${points[0]} l`
    : `${points[0]} m ${points.slice(1).map((point) => `${point} l`).join(' ')}`
  return { bounds, ref: appearance(output, bounds.width, bounds.height,
    `q ${r} ${g} ${b} RG ${stroke.radius * 2} w 1 J 1 j ${path} S Q`) }
}

async function addElementAnnotation(
  output: PDFDocument,
  page: ReturnType<PDFDocument['addPage']>,
  model: EditorPage,
  element: PageElement,
  prelude: string,
) {
  if (element.kind === 'stroke' && !element.points.length) return
  let bounds: { x: number; y: number; width: number; height: number }
  let appearanceRef
  if (element.kind === 'typst') {
    bounds = element
    const fragment = await compileTypstPdf(element.source, element.width, element.height, prelude,
      element.topInset ?? DEFAULT_TYPST_TOP_INSET, element.pageFill ?? '')
    const [embedded] = await output.embedPdf(fragment, [0])
    appearanceRef = appearance(output, element.width, element.height,
      `q ${element.width / embedded.width} 0 0 ${element.height / embedded.height} 0 0 cm /Artwork Do Q`,
      { XObject: { Artwork: embedded.ref } })
  } else if (element.kind === 'image') {
    bounds = element
    const bytes = dataUrlBytes(element.dataUrl)
    const embedded = element.mime === 'image/png' ? await output.embedPng(bytes) : await output.embedJpg(bytes)
    const artwork = imageSourceBox(element)
    // PDF coordinates start at the bottom, while source crop coordinates start at the top.
    const bottom = element.height - artwork.height - artwork.y
    appearanceRef = appearance(output, element.width, element.height,
      `q 0 0 ${element.width} ${element.height} re W n ${artwork.width} 0 0 ${artwork.height} ${artwork.x} ${bottom} cm /Artwork Do Q`,
      { XObject: { Artwork: embedded.ref } })
  } else {
    const stroke = strokeAppearance(output, element)
    bounds = stroke.bounds
    appearanceRef = stroke.ref
  }

  const annotation = output.context.obj({
    Type: 'Annot', Subtype: 'Stamp',
    Rect: [bounds.x, model.height - bounds.y - bounds.height, bounds.x + bounds.width, model.height - bounds.y],
    F: 4,
    NM: PDFHexString.fromText(`${annotationPrefix}${element.id}`),
    AP: { N: appearanceRef },
  })
  page.node.addAnnot(output.context.register(annotation))
}

function saveManifest(output: PDFDocument, document: EditorDocument) {
  const manifest: Manifest = {
    version: 1,
    prelude: document.prelude,
    pages: document.pages.map((page) => page.elements.map((element) => {
      if (element.kind !== 'typst') return element
      return { id: element.id, kind: element.kind, x: element.x, y: element.y,
        width: element.width, height: element.height, source: element.source,
        topInset: element.topInset, pageFill: element.pageFill }
    })),
  }
  const encoded = new TextEncoder().encode(JSON.stringify(manifest))
  const binary = Array.from(encoded, (byte) => String.fromCharCode(byte)).join('')
  const stream = output.context.register(output.context.flateStream(binary))
  const pieceInfo = output.catalog.lookupMaybe(PDFName.of('PieceInfo'), PDFDict) ?? output.context.obj({})
  pieceInfo.set(appKey, output.context.obj({
    LastModified: PDFString.fromDate(new Date()),
    Private: { Manifest: stream },
  }))
  output.catalog.set(PDFName.of('PieceInfo'), pieceInfo)
}

export async function exportPdf(document: EditorDocument) {
  const output = await PDFDocument.create()
  const source = document.originalPdf ? await PDFDocument.load(document.originalPdf) : null

  for (const model of document.pages) {
    const page = source && model.sourceIndex !== null
      ? output.addPage((await output.copyPages(source, [model.sourceIndex]))[0])
      : output.addPage([model.width, model.height])
    for (const element of model.elements) {
      await addElementAnnotation(output, page, model, element, document.prelude)
    }
  }

  saveManifest(output, document)
  output.setTitle(document.name)
  output.setProducer('Typstability')
  output.setCreator('Typstability')
  return output.save()
}

export function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
