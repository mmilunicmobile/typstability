// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist'
import type { EditorDocument } from '../types'
import { exportPdf, readPdf } from './pdf'

// CI runs on Node 22, which lacks Promise.try used by the standard PDF.js build.
vi.mock('pdfjs-dist', () => import('pdfjs-dist/legacy/build/pdf.mjs'))

vi.mock('../typst/client', () => ({
  compileTypstPdf: async (_source: string, width: number, height: number) => {
    const pdf = await PDFDocument.create()
    pdf.addPage([width, height]).drawText('Typeset', { x: 4, y: height - 16 })
    return pdf.save()
  },
}))

function asFile(bytes: Uint8Array) {
  return {
    name: 'roundtrip.pdf',
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  } as File
}

describe('editable PDF round trip', () => {
  it('restores Typst source, prelude, image, and stroke without duplicating annotations', async () => {
    const cwd = (globalThis as typeof globalThis & { process: { cwd: () => string } }).process.cwd()
    pdfjs.GlobalWorkerOptions.workerSrc = `file://${cwd}/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs`
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg=='
    const base = await PDFDocument.create()
    base.addPage([612, 792]).drawText('Original page', { x: 25, y: 750 })
    const original: EditorDocument = {
      name: 'Example',
      prelude: '#let brand = blue',
      defaultTopInset: 9,
      originalPdf: await base.save(),
      pages: [{
        id: 'page-1', sourceIndex: 0, width: 612, height: 792,
        elements: [
          { id: 'type-1', kind: 'typst', x: 24, y: 30, width: 130, height: 60, source: '#text(fill: brand)[Hello]', topInset: 6, pageFill: 'rgb("#f5f0e6")' },
          { id: 'image-1', kind: 'image', x: 60, y: 120, width: 40, height: 40, dataUrl: png, mime: 'image/png', crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.8 } },
          { id: 'stroke-1', kind: 'stroke', points: [{ x: 20, y: 200 }, { x: 50, y: 210 }], color: '#ff0000', radius: 2 },
        ],
      }],
      updatedAt: 0,
    }
    const first = await exportPdf(original)
    const viewer = await pdfjs.getDocument({ data: first.slice() }).promise
    const viewerPage = await viewer.getPage(1)
    expect((await viewerPage.getTextContent()).items.some((item) => 'str' in item && item.str === 'Original page')).toBe(true)
    const annotations = await viewerPage.getAnnotations()
    expect(annotations).toHaveLength(3)
    expect(annotations.every((annotation) => annotation.hasAppearance)).toBe(true)
    if (!('getOrInsertComputed' in Map.prototype)) {
      Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
        value: function <K, V>(this: Map<K, V>, key: K, make: (key: K) => V) {
          if (!this.has(key)) this.set(key, make(key))
          return this.get(key)
        },
      })
    }
    const rendered = await viewerPage.getOperatorList({ annotationMode: pdfjs.AnnotationMode.ENABLE })
    const background = await viewerPage.getOperatorList({ annotationMode: pdfjs.AnnotationMode.DISABLE })
    expect(rendered.fnArray.length).toBeGreaterThan(background.fnArray.length)
    const exported = await PDFDocument.load(first)
    expect(exported.getPage(0).node.Annots()?.size()).toBe(3)
    const firstAnnotation = exported.context.lookup(exported.getPage(0).node.Annots()!.get(0), PDFDict)
    expect(firstAnnotation.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N'))).toBeTruthy()
    expect(firstAnnotation.lookup(PDFName.of('NM'), PDFHexString).decodeText()).toBe('Typstability:type-1')
    const imageAnnotation = exported.context.lookup(exported.getPage(0).node.Annots()!.get(1), PDFDict)
    const imageAppearance = exported.context.lookup(imageAnnotation.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N')))
    if (!(imageAppearance instanceof PDFRawStream)) throw new Error('Expected an image appearance stream.')
    const commands = new TextDecoder().decode(decodePDFRawStream(imageAppearance).decode())
    // The original artwork is expanded and clipped to the retained rectangle;
    // translation uses the PDF's bottom-left coordinate origin.
    expect(commands).toBe('q 0 0 40 40 re W n 80 0 0 50 -20 -5 cm /Artwork Do Q')

    const reopened = await readPdf(asFile(first))
    expect(reopened.prelude).toBe(original.prelude)
    expect(reopened.defaultTopInset).toBe(9)
    expect(reopened.pages[0].elements).toEqual(original.pages[0].elements)
    const clean = await PDFDocument.load(reopened.originalPdf!)
    expect(clean.getPage(0).node.Annots()?.size() ?? 0).toBe(0)

    const second = await exportPdf(reopened)
    const again = await PDFDocument.load(second)
    expect(again.getPage(0).node.Annots()?.size()).toBe(3)

    const edited = { ...reopened, pages: reopened.pages.map((page) => ({
      ...page,
      elements: page.elements.filter((element) => element.id !== 'image-1').map((element) =>
        element.kind === 'typst' ? { ...element, source: 'Changed' } : element),
    })) }
    const editedPdf = await readPdf(asFile(await exportPdf(edited)))
    expect(editedPdf.pages[0].elements).toHaveLength(2)
    expect(editedPdf.pages[0].elements.find((element) => element.kind === 'typst')).toMatchObject({ source: 'Changed' })
  })
})
