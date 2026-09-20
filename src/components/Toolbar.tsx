import {
  Braces,
  Download,
  Eraser,
  FilePlus2,
  ImagePlus,
  MousePointer2,
  PenLine,
  Redo2,
  RotateCcw,
  Type,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { Tool } from '../types'

type Props = {
  name: string
  tool: Tool
  zoom: number
  canUndo: boolean
  canRedo: boolean
  exporting: boolean
  penColor: string
  penRadius: number
  eraserRadius: number
  preludeOpen: boolean
  onOpen: () => void
  onNew: () => void
  onImage: () => void
  onTool: (tool: Tool) => void
  onBlankPage: () => void
  onUndo: () => void
  onRedo: () => void
  onZoom: (zoom: number) => void
  onExport: () => void
  onPenColor: (color: string) => void
  onPenRadius: (radius: number) => void
  onEraserRadius: (radius: number) => void
  onPrelude: () => void
}

const ToolButton = ({ active, title, onClick, children }: {
  active?: boolean
  title: string
  onClick: () => void
  children: React.ReactNode
}) => (
  <button className={`tool-button ${active ? 'is-active' : ''}`} title={title} onClick={onClick}>
    {children}
  </button>
)

export function Toolbar(props: Props) {
  return (
    <header className="toolbar">
      <div className="brand" title={props.name}>
        <span className="brand-mark">T</span>
        <span className="document-name">{props.name}</span>
      </div>
      <div className="toolbar-group document-controls">
        <ToolButton title="Open PDF" onClick={props.onOpen}><Upload size={17} /></ToolButton>
        <ToolButton title="New document" onClick={props.onNew}><FilePlus2 size={17} /></ToolButton>
      </div>
      <div className="toolbar-separator" />
      <div className="toolbar-group edit-controls">
        <ToolButton active={props.tool === 'select'} title="Select" onClick={() => props.onTool('select')}>
          <MousePointer2 size={17} />
        </ToolButton>
        <ToolButton title="Insert image" onClick={props.onImage}><ImagePlus size={17} /></ToolButton>
        <ToolButton active={props.tool === 'typst'} title="Draw a Typst text box" onClick={() => props.onTool('typst')}>
          <Type size={18} />
        </ToolButton>
        <ToolButton active={props.tool === 'pen'} title="Pen" onClick={() => props.onTool('pen')}>
          <PenLine size={17} />
        </ToolButton>
        <ToolButton active={props.tool === 'eraser'} title="Erase pen strokes" onClick={() => props.onTool('eraser')}>
          <Eraser size={17} />
        </ToolButton>
        <ToolButton title="Insert blank page" onClick={props.onBlankPage}><FilePlus2 size={17} /></ToolButton>
        <ToolButton active={props.preludeOpen} title="Edit Typst prelude" onClick={props.onPrelude}>
          <Braces size={17} />
        </ToolButton>
      </div>
      {props.tool === 'pen' && (
        <div className="pen-controls">
          <input
            type="color"
            value={props.penColor}
            onChange={(event) => props.onPenColor(event.target.value)}
            aria-label="Pen color"
          />
          <input
            type="range"
            min="1"
            max="12"
            step="0.5"
            value={props.penRadius}
            onChange={(event) => props.onPenRadius(Number(event.target.value))}
            aria-label="Pen radius"
          />
          <span>{props.penRadius}px</span>
        </div>
      )}
      {props.tool === 'eraser' && (
        <div className="pen-controls">
          <input
            type="range"
            min="4"
            max="32"
            step="1"
            value={props.eraserRadius}
            onChange={(event) => props.onEraserRadius(Number(event.target.value))}
            aria-label="Eraser radius"
          />
          <span>{props.eraserRadius}px</span>
        </div>
      )}
      <div className="toolbar-spacer" />
      <div className="toolbar-group history-controls">
        <button className="tool-button" title="Undo" onClick={props.onUndo} disabled={!props.canUndo}><Undo2 size={17} /></button>
        <button className="tool-button" title="Redo" onClick={props.onRedo} disabled={!props.canRedo}><Redo2 size={17} /></button>
      </div>
      <div className="zoom-control">
        <button onClick={() => props.onZoom(props.zoom - 0.1)} aria-label="Zoom out"><ZoomOut size={15} /></button>
        <span>{Math.round(props.zoom * 100)}%</span>
        <button onClick={() => props.onZoom(props.zoom + 0.1)} aria-label="Zoom in"><ZoomIn size={15} /></button>
      </div>
      <button className="export-button" onClick={props.onExport} disabled={props.exporting}>
        {props.exporting ? <RotateCcw className="spin" size={16} /> : <Download size={16} />}
        <span>{props.exporting ? 'Exporting' : 'Export PDF'}</span>
      </button>
    </header>
  )
}
