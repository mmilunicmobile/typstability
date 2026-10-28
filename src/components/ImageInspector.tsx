import { useRef, useState } from 'react'
import { Crop, RotateCcw, Trash2, X } from 'lucide-react'
import type { Box, ImageElement, Point } from '../types'
import { cropFromPoints, cropImage, FULL_IMAGE_CROP, getImageCrop } from '../lib/image-crop'
import { InspectorPanel } from './InspectorPanel'

type Props = {
  element: ImageElement
  onChange: (next: ImageElement) => void
  onDelete: () => void
  onClose: () => void
}

const percent = (value: number) => Math.round(value * 10000) / 100

export function ImageInspector({ element, onChange, onDelete, onClose }: Props) {
  const applied = getImageCrop(element)
  const [draft, setDraft] = useState<Box>(applied)
  const [previewRatio, setPreviewRatio] = useState<number | null>(null)
  const dragStart = useRef<Point | null>(null)
  const changed = (['x', 'y', 'width', 'height'] as const).some((key) => Math.abs(draft[key] - applied[key]) > 1e-9)
  const edges = { left: draft.x, top: draft.y, right: 1 - draft.x - draft.width, bottom: 1 - draft.y - draft.height }

  const setEdge = (edge: keyof typeof edges, value: number) => {
    if (!Number.isFinite(value)) return
    const opposite = edge === 'left' ? edges.right : edge === 'right' ? edges.left : edge === 'top' ? edges.bottom : edges.top
    const inset = Math.max(0, Math.min(0.99 - opposite, value / 100))
    if (edge === 'left') setDraft({ ...draft, x: inset, width: 1 - inset - edges.right })
    if (edge === 'right') setDraft({ ...draft, width: 1 - draft.x - inset })
    if (edge === 'top') setDraft({ ...draft, y: inset, height: 1 - inset - edges.bottom })
    if (edge === 'bottom') setDraft({ ...draft, height: 1 - draft.y - inset })
  }

  return (
    <InspectorPanel label="Image editor">
      <div className="inspector-header">
        <div><strong><Crop size={14} /> Image crop</strong><span>Keep the part of the image you need.</span></div>
        <button className="icon-button" onClick={onClose} aria-label="Close image editor"><X size={16} /></button>
      </div>
      <div className="image-crop-editor">
        <p id="image-crop-instructions">Drag over the original image to select a crop, or adjust the edges below. Apply to update the page.</p>
        <div className="image-crop-preview" aria-label="Crop selection preview" aria-describedby="image-crop-instructions"
          style={{ maxWidth: previewRatio ? 320 * previewRatio : undefined }}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            const rect = event.currentTarget.getBoundingClientRect()
            if (!rect.width || !rect.height) return
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            dragStart.current = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
          }}
          onPointerMove={(event) => {
            if (!dragStart.current) return
            const rect = event.currentTarget.getBoundingClientRect()
            setDraft(cropFromPoints(dragStart.current, { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }))
          }}
          onPointerUp={() => { dragStart.current = null }}
          onPointerCancel={() => { dragStart.current = null }}
          onLostPointerCapture={() => { dragStart.current = null }}>
          <img src={element.dataUrl} alt="Original image for cropping" draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget
              if (image.naturalWidth && image.naturalHeight) setPreviewRatio(image.naturalWidth / image.naturalHeight)
            }} />
          <span className="image-crop-selection" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.width * 100}%`, height: `${draft.height * 100}%` }} />
        </div>
        <div className="image-crop-edges">
          {(Object.keys(edges) as (keyof typeof edges)[]).map((edge) => <label key={edge}>
            {edge[0].toUpperCase() + edge.slice(1)}
            <span><input type="number" aria-label={`Crop ${edge}`} min={0} max={99} step={0.1}
              value={percent(edges[edge])} onChange={(event) => setEdge(edge, event.currentTarget.valueAsNumber)} />%</span>
          </label>)}
        </div>
        <div className="image-crop-actions">
          <button className="primary-button" disabled={!changed} onClick={() => onChange(cropImage(element, draft))}>Apply crop</button>
          <button className="secondary-button" disabled={!changed} onClick={() => setDraft(applied)}>Cancel</button>
        </div>
        <button className="secondary-button" disabled={!element.crop} onClick={() => onChange(cropImage(element, FULL_IMAGE_CROP))}><RotateCcw size={14} /> Reset crop</button>
        <p className="image-crop-note">The original image is saved. Reset crop restores it at any time.</p>
      </div>
      <div className="source-footer">
        <span className="source-status">{Math.round(element.width)} × {Math.round(element.height)} pt</span>
        <button className="icon-button delete-source" onClick={onDelete} aria-label="Delete image"><Trash2 size={15} /></button>
      </div>
    </InspectorPanel>
  )
}
