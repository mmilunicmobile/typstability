import { useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EditorPage } from '../types'
import { renderPdfPage } from '../lib/pdf'

const THUMBNAIL_WIDTH = 62

type Props = {
  page: EditorPage
  pdf: PDFDocumentProxy | null
}

export function PageThumbnail({ page, pdf }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scale = THUMBNAIL_WIDTH / page.width

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !pdf || page.sourceIndex === null) return
    void renderPdfPage(pdf, page.sourceIndex + 1, canvas, scale)
  }, [page.sourceIndex, pdf, scale])

  return (
    <span
      className="thumbnail-paper"
      style={{ width: THUMBNAIL_WIDTH, height: page.height * scale }}
      aria-hidden="true"
    >
      {page.sourceIndex === null ? <span className="thumbnail-blank" /> : <canvas ref={canvasRef} />}
    </span>
  )
}
