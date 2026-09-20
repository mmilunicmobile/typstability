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
import { renderPdfPage } from '../lib/pdf'

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
  interactive: boolean
  selected: boolean
  onSelect: () => void
  onChange: (next: ImageElement | TypstElement, record?: boolean) => void
  onResizeEnd: (next: ImageElement | TypstElement) => void
  onDrop: (next: ImageElement | TypstElement, drop: ObjectDrop) => void
  onDragPreview: (preview: ObjectDragPreview | null) => void
}

function CanvasObject({ element, interactive, selected, onSelect, onChange, onResizeEnd, onDrop, onDragPreview }: ObjectProps) {
  const shapeRef = useRef<Konva.Image | Konva.Rect>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const grabOffset = useRef<Point>({ x: 0, y: 0 })
  const image = useImage(
    element.kind === 'image' ? element.dataUrl : element.previewSvg,
    element.kind === 'typst',
  )

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
      width: Math.max(24, node.width() * scaleX),
      height: Math.max(18, node.height() * scaleY),
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
      onDragPreview({
        element,
        clientX: event.evt.clientX,
        clientY: event.evt.clientY,
        grabOffset: grabOffset.current,
      })
    },
    onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => {
      onDragPreview(null)
      onDrop(normalizedElement(), {
        clientX: event.evt.clientX,
        clientY: event.evt.clientY,
        grabOffset: grabOffset.current,
      })
    },
    onTransformStart: () => onChange(element, true),
    onTransform: () => {
      if (element.kind === 'typst') onChange(normalizedElement(), false)
    },
    onTransformEnd: () => {
      const next = normalizedElement()
      onChange(next, false)
      onResizeEnd(next)
    },
  }

  return (
    <>
      {element.kind === 'image' ? (
        <KonvaImage
          ref={shapeRef as React.RefObject<Konva.Image>}
          image={image ?? undefined}
          {...common}
          stroke={selected ? '#4d63ff' : undefined}
          strokeWidth={selected ? 1 : 0}
        />
      ) : (
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
            <Rect
              x={0}
              y={0}
              width={element.width}
              height={element.height}
              fill={image ? '#ffffff' : '#f5f4ef'}
              listening={false}
            />
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
          </Group>
          <Rect
            ref={shapeRef as React.RefObject<Konva.Rect>}
            {...common}
            fill="rgba(0, 0, 0, 0.001)"
            stroke={selected ? '#4d63ff' : image ? undefined : '#b7b5ad'}
            dash={image ? undefined : [4, 4]}
            strokeWidth={selected ? 1 : undefined}
          />
        </>
      )}
      {selected && (
        <Transformer
          ref={transformerRef}
          rotateEnabled={false}
          flipEnabled={false}
          borderStroke="#4d63ff"
          anchorFill="#ffffff"
          anchorStroke="#4d63ff"
          anchorSize={7}
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < 24 || newBox.height < 18 ? oldBox : newBox
          }
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

type BoxGesture = { start: Point; current: Point }

export function CanvasPage({
  page,
  pageNumber,
  pdf,
  zoom,
  tool,
  selection,
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
  const [temporaryStroke, setTemporaryStroke] = useState<Point[]>([])
  const [temporaryBox, setTemporaryBox] = useState<BoxGesture | null>(null)
  const [eraserPoint, setEraserPoint] = useState<Point | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !pdf || page.sourceIndex === null) return
    void renderPdfPage(pdf, page.sourceIndex + 1, canvas, zoom)
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
    return point ? { x: point.x / zoom, y: point.y / zoom } : null
  }

  const finishGesture = () => {
    if (tool === 'pen' && temporaryStroke.length) onAddStroke(temporaryStroke)
    if (tool === 'typst' && box && box.width >= 30 && box.height >= 24) onCreateTypst(box)
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
          else if (tool === 'typst') setTemporaryBox({ start: point, current: point })
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
            setTemporaryBox((current) => current ? { ...current, current: point } : current)
          } else if (tool === 'eraser') {
            setEraserPoint(point)
            if (event.evt.buttons) onEraseAt(point)
          }
        }}
        onPointerUp={finishGesture}
        onPointerLeave={() => {
          finishGesture()
          setEraserPoint(null)
        }}
      >
        <Layer>
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
              stroke="#4d63ff"
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
