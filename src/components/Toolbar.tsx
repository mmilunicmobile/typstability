import {
  ArrowLeft, Braces, Check, Download, Eraser, FileDown, FileText,
  ImagePlus, MousePointer2, PenLine, Plus, Redo2, RotateCcw, Type, Undo2, AlertCircle,
} from 'lucide-react'
import type { Tool } from '../types'
import { ActionMenu } from './ActionMenu'
import { ThemeToggle } from './ThemeToggle'

type Props = {
  name: string
  saveStatus: string
  onRename: (name: string) => void
  onProjects: () => void
  onExportProject: () => void
  tool: Tool
  canUndo: boolean
  canRedo: boolean
  exporting: boolean
  penColor: string
  penRadius: number
  eraserRadius: number
  preludeOpen: boolean
  onImage: () => void
  onTool: (tool: Tool) => void
  onBlankPage: () => void
  onUndo: () => void
  onRedo: () => void
  onExport: () => void
  onPenColor: (color: string) => void
  onPenRadius: (radius: number) => void
  onEraserRadius: (radius: number) => void
  onPrelude: () => void
}

export function Toolbar(props: Props) {
  const tools = [
    { id: 'select', label: 'Select', icon: <MousePointer2 size={17} />, hint: 'Move and resize objects' },
    { id: 'typst', label: 'Text', icon: <Type size={18} />, hint: 'Drag on a page to add a Typst text box' },
    { id: 'pen', label: 'Draw', icon: <PenLine size={17} />, hint: 'Draw freehand on a page' },
    { id: 'eraser', label: 'Erase', icon: <Eraser size={17} />, hint: 'Erase pen strokes' },
  ] as const
  return <header className="editor-header">
    <div className="project-bar">
      <button className="back-button" aria-label="Back to projects" onClick={props.onProjects} title="Back to your projects"><ArrowLeft size={17} /><span>Projects</span></button>
      <span className="header-divider" />
      <img className="app-logo editor-logo" src={`${import.meta.env.BASE_URL}typstability-logo.png`} alt="Typstability" />
      <div className="project-identity">
        <input className="project-title" aria-label="Project name" maxLength={180} title="Click to rename this project" value={props.name}
          onChange={(event) => props.onRename(event.target.value)}
          onBlur={(event) => props.onRename(event.target.value.trim() || 'Untitled document')}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
        <span className={`save-status ${props.saveStatus === 'Save failed' ? 'save-error' : ''}`} role="status">
          {props.saveStatus === 'Saved' ? <Check size={12} /> : props.saveStatus === 'Save failed' ? <AlertCircle size={12} /> : <RotateCcw className="spin" size={11} />}
          <span className="save-status-label">{props.saveStatus === 'Saved' ? 'Saved in this browser' : props.saveStatus}</span>
        </span>
      </div>
    </div>
    <div className="editing-bar" aria-label="Editing tools">
      <div className="tool-picker" role="group" aria-label="Choose a tool">
        {tools.map((tool) => <button key={tool.id} className={`editing-tool ${props.tool === tool.id ? 'is-active' : ''}`}
          title={tool.hint} aria-pressed={props.tool === tool.id} onClick={() => props.onTool(tool.id)}>{tool.icon}<span>{tool.label}</span></button>)}
      </div>
      <span className="header-divider" />
      <ActionMenu label="Insert" icon={<Plus size={17} />} align="left" items={[
        { label: 'Image', description: 'Add PNG, JPEG, WebP, or GIF images.', icon: <ImagePlus size={18} />, onSelect: props.onImage },
        { label: 'Blank page', description: 'Insert a page after the current one.', icon: <FileText size={18} />, onSelect: props.onBlankPage },
      ]} />
      <button className={`styles-button ${props.preludeOpen ? 'is-active' : ''}`} aria-pressed={props.preludeOpen} onClick={props.onPrelude} title="Set fonts, font size, padding, and shared Typst definitions for this document"><Braces size={17} /><span>Document styles</span></button>
      <div className="history-controls" role="group" aria-label="Edit history">
        <button className="icon-button" title="Undo" aria-label="Undo" onClick={props.onUndo} disabled={!props.canUndo}><Undo2 size={17} /></button>
        <button className="icon-button" title="Redo" aria-label="Redo" onClick={props.onRedo} disabled={!props.canRedo}><Redo2 size={17} /></button>
      </div>
      {(props.tool === 'pen' || props.tool === 'eraser') && <div className="tool-options">
        {props.tool === 'pen' && <label>Color <input type="color" value={props.penColor} onChange={(event) => props.onPenColor(event.target.value)} /></label>}
        <label>{props.tool === 'pen' ? 'Brush size' : 'Eraser size'}
          <input type="range" min={props.tool === 'pen' ? 1 : 4} max={props.tool === 'pen' ? 12 : 32} step={props.tool === 'pen' ? 0.5 : 1}
            value={props.tool === 'pen' ? props.penRadius : props.eraserRadius}
            onChange={(event) => props.tool === 'pen' ? props.onPenRadius(Number(event.target.value)) : props.onEraserRadius(Number(event.target.value))} />
          <output>{2 * (props.tool === 'pen' ? props.penRadius : props.eraserRadius)}px</output>
        </label>
      </div>}
    </div>
    <div className="toolbar-actions">
      <ThemeToggle />
      <ActionMenu label={props.exporting ? 'Exporting…' : 'Export'} primary disabled={props.exporting}
        icon={props.exporting ? <RotateCcw className="spin" size={16} /> : <Download size={16} />}
        items={[
          { label: 'PDF document', description: 'A finished PDF to share or print.', icon: <FileText size={20} />, onSelect: props.onExport },
          { label: 'Editable project', description: 'A .typstability backup to keep editing later.', icon: <FileDown size={20} />, onSelect: props.onExportProject },
        ]} />
    </div>
  </header>
}
