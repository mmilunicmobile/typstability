import { useEffect, useMemo, useRef, useState } from 'react'
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva'
import Konva from 'konva'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type {
  Box,
  EditorPage,
  ImageElement,
  ObjectDragPreview,
  ObjectDrop,
  PageElement,
  Point,
  Selection,
  Tool,
  TypstElement,
} from '../types'
import { GRID_SPACING, snapBoxPosition, type AlignmentGuides } from '../lib/alignment'
import { renderPdfPage } from '../lib/pdf'
import { canCreateBox, minimumBoxDimension, MIN_BOX_SCREEN_PIXELS } from '../lib/boxes'
import { imageSourceBox } from '../lib/image-crop'

function useImage(source?: string, isSvg = false) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    if (!source) {
      setImage(null)
      return
    }
    const element = new Image()
    const url = isSvg
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`
      : source
    element.onload = () => setImage(element)
    element.src = url
  }, [isSvg, source])

  return image
}

type ObjectProps = {
  element: ImageElement | TypstElement
  zoom: number
  page: EditorPage
  snapEnabled: boolean
  onGuides: (guides: AlignmentGuides) => void
  interactive: boolean
  selected: boolean
  onSelect: () => void
  onChange: (next: ImageElement | TypstElement, record?: boolean) => void
  onResizeEnd: (next: ImageElement | TypstElement) => void
  onDrop: (next: ImageElement | TypstElement, drop: ObjectDrop) => void
  onDragPreview: (preview: ObjectDragPreview | null) => void
}

function CanvasObject({ element, zoom, page, snapEnabled, onGuides, interactive, selected, onSelect, onChange, onResizeEnd, onDrop, onDragPreview }: ObjectProps) {
  const shapeRef = useRef<Konva.Rect>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const grabOffset = useRef<Point>({ x: 0, y: 0 })
  const image = useImage(
    element.kind === 'image' ? element.dataUrl : element.previewSvg,
    element.kind === 'typst',
  )
  const emptyText = element.kind === 'typst' && !element.source.trim()

  useEffect(() => {
    if (selected && shapeRef.current && transformerRef.current) {
      transformerRef.current.nodes([shapeRef.current])
      transformerRef.current.getLayer()?.batchDraw()
    }
  })

  const normalizedElement = () => {
    const node = shapeRef.current
    if (!node) return element
    const scaleX = node.scaleX()
    const scaleY = node.scaleY()
    const next = {
      ...element,
      x: node.x(),
      y: node.y(),
      width: Math.max(element.kind === 'typst' ? minimumBoxDimension(zoom) : 24, node.width() * scaleX),
      height: Math.max(element.kind === 'typst' ? minimumBoxDimension(zoom) : 18, node.height() * scaleY),
    }
    node.scaleX(1)
    node.scaleY(1)
    node.width(next.width)
    node.height(next.height)
    return next
  }

  const common = {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    draggable: interactive,
    listening: interactive,
    onClick: onSelect,
    onTap: onSelect,
    onDragStart: (event: Konva.KonvaEventObject<DragEvent>) => {
      onSelect()
      const node = shapeRef.current
      const stage = node?.getStage()
      const pointer = stage?.getPointerPosition()
      const scale = stage?.scaleX() || 1
      if (node && pointer) {
        grabOffset.current = { x: pointer.x / scale - node.x(), y: pointer.y / scale - node.y() }
      }
      onDragPreview({
        element,
        clientX: event.evt.clientX,
        clientY: event.evt.clientY,
        grabOffset: grabOffset.current,
      })
    },
    onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => {
      const node = shapeRef.current
      let moved = element
      if (node && snapEnabled && !event.evt.altKey) {
        const result = snapBoxPosition({ ...element, x: node.x(), y: node.y() }, page, zoom, element.id)
        node.position({ x: result.box.x, y: result.box.y })
        moved = result.box
        onGuides(result.guides)
      } else onGuides({})
      onDragPreview({
        element: moved,
        clientX: event.evt.clientX,
        clientY: event.evt.clientY,
        grabOffset: grabOffset.current,
      })
    },
    onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => {
      onGuides({})
      onDragPreview(null)
      onDrop(normalizedElement(), {
        disableSnap: event.evt.altKey,
        clientX: event.evt.clientX,
        clientY: event.evt.clientY,
        grabOffset: grabOffset.current,
      })
    },
    onTransformStart: () => onChange(element, true),
    onTransform: () => onChange(normalizedElement(), false),
    onTransformEnd: () => {
      const next = normalizedElement()
      onChange(next, false)
      onResizeEnd(next)
    },
  }

  return (
    <>
      <Group
        x={element.x}
        y={element.y}
        clipX={0}
        clipY={0}
        clipWidth={element.width}
        clipHeight={element.height}
        listening={false}
      >
        {element.kind === 'image' ? (
          image && <KonvaImage image={image} {...imageSourceBox(element)} listening={false} />
        ) : (
          <>
            {!image && <Rect
              x={0}
              y={0}
              width={element.width}
              height={element.height}
              fill="#f5f4ef"
              listening={false}
            />}
            {image ? (
              <KonvaImage
                image={image}
                x={0}
                y={0}
                width={element.previewWidth ?? element.width}
                height={element.previewHeight ?? element.height}
                listening={false}
              />
            ) : (
              <Text
                x={10}
                y={10}
                text={element.error ? 'Typst error' : 'Compiling Typst…'}
                fontSize={11}
                fill="#77746c"
                listening={false}
              />
            )}
          </>
        )}
        {emptyText && element.width > 90 && element.height > 22 && (
          <Text x={7} y={7} text="Click to edit text" fontSize={11} fill="#77746c" listening={false} />
        )}
      </Group>
      <Rect
        ref={shapeRef}
        {...common}
        fill="rgba(0, 0, 0, 0.001)"
        stroke={selected ? '#229ca8' : element.kind === 'typst' && (!image || emptyText) ? '#b7b5ad' : undefined}
        dash={element.kind === 'typst' && (!image || emptyText) ? [4, 4] : undefined}
        strokeWidth={selected ? 1 : undefined}
      />
      {selected && (
        <Transformer
          ref={transformerRef}
          rotateEnabled={false}
          flipEnabled={false}
          keepRatio={false}
          shiftBehavior="default"
          borderStroke="#229ca8"
          anchorFill="#ffffff"
          anchorStroke="#229ca8"
          anchorSize={7}
          boundBoxFunc={(oldBox, newBox) => {
            const minimumWidth = element.kind === 'typst' ? MIN_BOX_SCREEN_PIXELS : 24 * zoom
            const minimumHeight = element.kind === 'typst' ? MIN_BOX_SCREEN_PIXELS : 18 * zoom
            return newBox.width < minimumWidth || newBox.height < minimumHeight ? oldBox : newBox
          }}
        />
      )}
    </>
  )
}

type Props = {
  page: EditorPage
  pageNumber: number
  pdf: PDFDocumentProxy | null
  zoom: number
  tool: Tool
  selection: Selection
  showGrid?: boolean
  snapEnabled?: boolean
  penColor: string
  penRadius: number
  eraserRadius: number
  onActivate: () => void
  onSelect: (elementId: string | null) => void
  onChangeElement: (element: PageElement, record?: boolean) => void
  onResizeEnd: (element: ImageElement | TypstElement) => void
  onDropElement: (element: ImageElement | TypstElement, drop: ObjectDrop) => void
  onDragPreview: (preview: ObjectDragPreview | null) => void
  onAddStroke: (points: Point[]) => void
  onEraseAt: (point: Point) => void
  onCreateTypst: (box: Box) => void
}

type BoxGesture = { start: Point; current: Point; rawStart?: Point }

export function CanvasPage({
  page,
  pageNumber,
  pdf,
  zoom,
  tool,
  selection,
  showGrid = false,
  snapEnabled = false,
  penColor,
  penRadius,
  eraserRadius,
  onActivate,
  onSelect,
  onChangeElement,
  onResizeEnd,
  onDropElement,
  onDragPreview,
  onAddStroke,
  onEraseAt,
  onCreateTypst,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [guides, setGuides] = useState<AlignmentGuides>({})
  const [temporaryStroke, setTemporaryStroke] = useState<Point[]>([])
  const [temporaryBox, setTemporaryBox] = useState<BoxGesture | null>(null)
  const [eraserPoint, setEraserPoint] = useState<Point | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !pdf || page.sourceIndex === null) return
    const controller = new AbortController()
    void renderPdfPage(pdf, page.sourceIndex + 1, canvas, zoom, controller.signal).catch(console.error)
    return () => controller.abort()
  }, [page.sourceIndex, pdf, zoom])

  const flatTemporaryPoints = useMemo(
    () => temporaryStroke.flatMap((point) => [point.x, point.y]),
    [temporaryStroke],
  )

  const box = temporaryBox ? {
    x: Math.min(temporaryBox.start.x, temporaryBox.current.x),
    y: Math.min(temporaryBox.start.y, temporaryBox.current.y),
    width: Math.abs(temporaryBox.current.x - temporaryBox.start.x),
    height: Math.abs(temporaryBox.current.y - temporaryBox.start.y),
  } : null

  const pointerPosition = (stage: Konva.Stage) => {
    const point = stage.getPointerPosition()
    if (!point) return null
    const position = { x: point.x / zoom, y: point.y / zoom }
    return position
  }

  const finishGesture = (allowTextClick = false) => {
    if (tool === 'pen' && temporaryStroke.length) onAddStroke(temporaryStroke)
    if (tool === 'typst' && box) {
      // Drawing stays on the stage, even when a drag crosses another box.
      // A click in Text mode opens the topmost existing box instead.
      if (canCreateBox(box, zoom)) onCreateTypst(box)
      else if (allowTextClick && temporaryBox) {
        const point = temporaryBox.rawStart ?? temporaryBox.start
        const target = [...page.elements].reverse().find((element) => element.kind === 'typst'
          && point.x >= element.x && point.x <= element.x + element.width
          && point.y >= element.y && point.y <= element.y + element.height)
        if (target) onSelect(target.id)
      }
    }
    setGuides({})
    setTemporaryStroke([])
    setTemporaryBox(null)
    if (tool !== 'eraser') setEraserPoint(null)
  }

  const drawingTool = tool === 'pen' || tool === 'typst' || tool === 'eraser'

  return (
    <section
      className={`page-shell ${drawingTool ? 'is-drawing' : ''}`}
      style={{ width: page.width * zoom, height: page.height * zoom }}
      onPointerDown={onActivate}
      aria-label={`Page ${pageNumber}`}
      data-page-id={page.id}
    >
      {page.sourceIndex === null ? (
        <div className="blank-page" />
      ) : (
        <canvas ref={canvasRef} className="pdf-canvas" />
      )}
      <Stage
        className="overlay-stage"
        width={page.width * zoom}
        height={page.height * zoom}
        scaleX={zoom}
        scaleY={zoom}
        onPointerDown={(event) => {
          onActivate()
          const stage = event.target.getStage()
          const point = stage ? pointerPosition(stage) : null
          if (!point) return
          if (tool === 'pen') setTemporaryStroke([point])
          else if (tool === 'typst') {
            const start = snapEnabled && !event.evt.altKey ? snapBoxPosition({ ...point, width: 0, height: 0 }, page, zoom).box : point
            setTemporaryBox({ start, current: start, rawStart: point })
          }
          else if (tool === 'eraser') {
            setEraserPoint(point)
            onEraseAt(point)
          } else if (event.target === stage) onSelect(null)
        }}
        onPointerMove={(event) => {
          const stage = event.target.getStage()
          const point = stage ? pointerPosition(stage) : null
          if (!point) return
          if (tool === 'pen' && temporaryStroke.length) {
            setTemporaryStroke((current) => [...current, point])
          } else if (tool === 'typst' && temporaryBox) {
            const snapped = snapEnabled && !event.evt.altKey ? snapBoxPosition({ ...point, width: 0, height: 0 }, page, zoom) : null
            setGuides(snapped?.guides ?? {})
            setTemporaryBox((current) => current ? { ...current, current: snapped?.box ?? point } : current)
          } else if (tool === 'eraser') {
            setEraserPoint(point)
            if (event.evt.buttons) onEraseAt(point)
          }
        }}
        onPointerUp={() => finishGesture(true)}
        onPointerLeave={() => {
          finishGesture()
          setEraserPoint(null)
        }}
      >
        <Layer>
          {showGrid && <Group listening={false}>
            {Array.from({ length: Math.floor(page.width / GRID_SPACING) + 1 }, (_, index) => <Line key={`grid-x-${index}`}
              points={[index * GRID_SPACING, 0, index * GRID_SPACING, page.height]} stroke="#229ca8" opacity={0.2} strokeWidth={0.5 / zoom} />)}
            {Array.from({ length: Math.floor(page.height / GRID_SPACING) + 1 }, (_, index) => <Line key={`grid-y-${index}`}
              points={[0, index * GRID_SPACING, page.width, index * GRID_SPACING]} stroke="#229ca8" opacity={0.2} strokeWidth={0.5 / zoom} />)}
          </Group>}
          {page.elements.map((element) => {
            if (element.kind === 'stroke') {
              return (
                <Line
                  key={element.id}
                  points={element.points.flatMap((point) => [point.x, point.y])}
                  stroke={element.color}
                  strokeWidth={element.radius * 2}
                  lineCap="round"
                  lineJoin="round"
                  tension={0.25}
                  listening={false}
                />
              )
            }
            return (
              <CanvasObject
                key={element.id}
                element={element}
                zoom={zoom}
                page={page}
                snapEnabled={snapEnabled}
                onGuides={setGuides}
                interactive={tool === 'select'}
                selected={tool === 'select' && selection?.pageId === page.id && selection.elementId === element.id}
                onSelect={() => onSelect(element.id)}
                onChange={onChangeElement}
                onResizeEnd={onResizeEnd}
                onDrop={onDropElement}
                onDragPreview={onDragPreview}
              />
            )
          })}
          {guides.x !== undefined && <Line points={[guides.x, 0, guides.x, page.height]} stroke="#d04794" strokeWidth={1 / zoom} dash={[4 / zoom, 3 / zoom]} listening={false} />}
          {guides.y !== undefined && <Line points={[0, guides.y, page.width, guides.y]} stroke="#d04794" strokeWidth={1 / zoom} dash={[4 / zoom, 3 / zoom]} listening={false} />}
          {!!temporaryStroke.length && (
            <Line
              points={flatTemporaryPoints}
              stroke={penColor}
              strokeWidth={penRadius * 2}
              lineCap="round"
              lineJoin="round"
              tension={0.25}
              listening={false}
            />
          )}
          {box && (
            <Rect
              {...box}
              fill="rgba(77, 99, 255, 0.08)"
              stroke="#229ca8"
              strokeWidth={1}
              dash={[6, 4]}
              listening={false}
            />
          )}
          {tool === 'eraser' && eraserPoint && (
            <Circle
              x={eraserPoint.x}
              y={eraserPoint.y}
              radius={eraserRadius}
              fill="rgba(255, 255, 255, 0.72)"
              stroke="#77746c"
              strokeWidth={1}
              listening={false}
            />
          )}
        </Layer>
      </Stage>
      <span className="page-number">{pageNumber}</span>
    </section>
  )
}
