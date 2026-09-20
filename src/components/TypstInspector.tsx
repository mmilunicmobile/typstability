import { Trash2, X } from 'lucide-react'
import type { TypstElement } from '../types'

type Props = {
  element: TypstElement
  onSourceChange: (source: string) => void
  onDelete: () => void
  onClose: () => void
}

export function TypstInspector({ element, onSourceChange, onDelete, onClose }: Props) {
  return (
    <aside className="inspector">
      <header className="inspector-header">
        <div>
          <strong>Typst</strong>
          <span>{Math.round(element.width)} × {Math.round(element.height)} pt</span>
        </div>
        <button className="icon-button" onClick={onClose} title="Close editor" aria-label="Close editor">
          <X size={16} />
        </button>
      </header>
      {element.error && <div className="compile-error">{element.error}</div>}
      <label className="source-label" htmlFor="typst-source">Source</label>
      <textarea
        id="typst-source"
        className="source-editor"
        value={element.source}
        onChange={(event) => onSourceChange(event.target.value)}
        spellCheck={false}
      />
      <div className="inspector-footer">
        <span>Typst compiles locally.</span>
        <button className="danger-button" onClick={onDelete}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </aside>
  )
}
