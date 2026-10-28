import { useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EditorPage, ImageElement, TypstElement } from '../types'
import { renderPdfPage } from '../lib/pdf'
import { imageCropStyle } from '../lib/image-crop'

const THUMBNAIL_WIDTH = 100

type Props = {
  page: EditorPage
  pdf: PDFDocumentProxy | null
}

function ThumbnailObject({ element, page }: { element: ImageElement | TypstElement; page: EditorPage }) {
  const source = element.kind === 'image'
    ? element.dataUrl
    : element.previewSvg
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(element.previewSvg)}`
      : null
  if (!source) return null

  return (
    <span className="thumbnail-object" style={{
      left: `${element.x / page.width * 100}%`,
      top: `${element.y / page.height * 100}%`,
      width: `${element.width / page.width * 100}%`,
      height: `${element.height / page.height * 100}%`,
    }}>
      <img src={source} alt="" draggable={false} style={element.kind === 'typst' ? {
        width: `${(element.previewWidth ?? element.width) / element.width * 100}%`,
        height: `${(element.previewHeight ?? element.height) / element.height * 100}%`,
      } : imageCropStyle(element)} />
    </span>
  )
}

export function PageThumbnail({ page, pdf }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scale = THUMBNAIL_WIDTH / page.width

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !pdf || page.sourceIndex === null) return
    const controller = new AbortController()
    void renderPdfPage(pdf, page.sourceIndex + 1, canvas, scale, controller.signal).catch(() => undefined)
    return () => controller.abort()
  }, [page.sourceIndex, pdf, scale])

  return (
    <span
      className="thumbnail-paper"
      style={{ width: '100%', aspectRatio: `${page.width} / ${page.height}` }}
      aria-hidden="true"
    >
      {page.sourceIndex === null ? <span className="thumbnail-blank" /> : <canvas ref={canvasRef} />}
      <span className="thumbnail-overlays">
        {page.elements.map((element) => element.kind === 'stroke' ? (
          <svg key={element.id} viewBox={`0 0 ${page.width} ${page.height}`} preserveAspectRatio="none" aria-hidden="true">
            {element.points.length === 1 ? (
              <circle cx={element.points[0].x} cy={element.points[0].y} r={element.radius} fill={element.color} />
            ) : (
              <polyline
                points={element.points.map((point) => `${point.x},${point.y}`).join(' ')}
                fill="none"
                stroke={element.color}
                strokeWidth={element.radius * 2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>
        ) : <ThumbnailObject key={element.id} element={element} page={page} />)}
      </span>
    </span>
  )
}
