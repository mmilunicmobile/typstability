import { PDFDocument } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { EditorDocument, EditorPage, TypstElement } from '../types'
import { uid } from '../types'
import { pdfColor } from './color'
import { compileTypstPdf } from '../typst/client'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

export async function readPdf(file: File): Promise<EditorDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise
  const pages: EditorPage[] = []

  for (let index = 0; index < pdf.numPages; index += 1) {
    const page = await pdf.getPage(index + 1)
    const viewport = page.getViewport({ scale: 1 })
    pages.push({
      id: uid(),
      sourceIndex: index,
      width: viewport.width,
      height: viewport.height,
      elements: [],
    })
  }

  return {
    name: file.name.replace(/\.pdf$/i, '') || 'Untitled',
    prelude: '',
    originalPdf: bytes,
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
) {
  const page = await proxy.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const outputScale = window.devicePixelRatio || 1
  const context = canvas.getContext('2d')
  if (!context) return
  canvas.width = Math.floor(viewport.width * outputScale)
  canvas.height = Math.floor(viewport.height * outputScale)
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`
  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
  }).promise
}

function dataUrlBytes(dataUrl: string) {
  const encoded = dataUrl.split(',')[1]
  const binary = atob(encoded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function drawElements(
  output: PDFDocument,
  page: ReturnType<PDFDocument['addPage']>,
  model: EditorPage,
  prelude: string,
) {
  for (const element of model.elements) {
    if (element.kind === 'image') {
      const bytes = dataUrlBytes(element.dataUrl)
      const embedded = element.mime === 'image/png'
        ? await output.embedPng(bytes)
        : await output.embedJpg(bytes)
      page.drawImage(embedded, {
        x: element.x,
        y: model.height - element.y - element.height,
        width: element.width,
        height: element.height,
      })
    }

    if (element.kind === 'stroke') {
      const color = pdfColor(element.color)
      const points = element.points
      for (let index = 1; index < points.length; index += 1) {
        page.drawLine({
          start: { x: points[index - 1].x, y: model.height - points[index - 1].y },
          end: { x: points[index].x, y: model.height - points[index].y },
          thickness: element.radius * 2,
          color,
        })
      }
      for (const point of points) {
        page.drawCircle({
          x: point.x,
          y: model.height - point.y,
          size: element.radius,
          color,
        })
      }
    }

    if (element.kind === 'typst') {
      const typst = element as TypstElement
      const fragment = await compileTypstPdf(typst.source, typst.width, typst.height, prelude)
      const [embedded] = await output.embedPdf(fragment, [0])
      page.drawPage(embedded, {
        x: typst.x,
        y: model.height - typst.y - typst.height,
        width: typst.width,
        height: typst.height,
      })
    }
  }
}

export async function exportPdf(document: EditorDocument) {
  const output = await PDFDocument.create()
  const source = document.originalPdf
    ? await PDFDocument.load(document.originalPdf)
    : null

  for (const model of document.pages) {
    let page
    if (source && model.sourceIndex !== null) {
      const [copied] = await output.copyPages(source, [model.sourceIndex])
      page = output.addPage(copied)
    } else {
      page = output.addPage([model.width, model.height])
    }
    await drawElements(output, page, model, document.prelude)
  }

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
