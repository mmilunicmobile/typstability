import { CompileErrors } from './CompileErrors'
import { InspectorPanel } from './InspectorPanel'
import { Braces, Trash2, X } from 'lucide-react'
import type { TypstElement } from '../types'
import { TypstCodeEditor, type EditorSessions } from './TypstCodeEditor'
import { DEFAULT_TYPST_TOP_INSET } from '../typst/source'

type Props = {
  element: TypstElement
  prelude?: string
  documentKey: string
  sessions: EditorSessions
  onSourceChange: (source: string) => void
  onTopInsetChange: (topInset: number) => void
  onPageFillChange: (pageFill: string) => void
  onDocumentStyles: () => void
  onDelete: () => void
  onClose: () => void
  focusRequest?: number
}

export function TypstInspector({ element, prelude = '', documentKey, sessions, onSourceChange, onTopInsetChange, onPageFillChange, onDocumentStyles, onDelete, onClose, focusRequest }: Props) {
  return (
    <InspectorPanel label="Text box editor">
      <header className="inspector-header">
        <div>
          <strong>Text box</strong>
          <span>{Math.round(element.width)} × {Math.round(element.height)} pt</span>
        </div>
        <button className="icon-button" onClick={onClose} title="Close editor" aria-label="Close editor">
          <X size={16} />
        </button>
      </header>
      <div className="typst-settings-row">
        <label className="typst-inset-control" htmlFor="typst-top-inset">
          <span>Top inset</span>
          <input
            id="typst-top-inset"
            type="number"
            min="0"
            max="200"
            step="1"
            value={element.topInset ?? DEFAULT_TYPST_TOP_INSET}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (Number.isFinite(value)) onTopInsetChange(Math.min(200, Math.max(0, value)))
            }}
            aria-label="Top inset"
          />
          <span>pt</span>
        </label>
        <label className="typst-fill-control" htmlFor="typst-page-fill">
          <span>Fill (Typst)</span>
          <input
            id="typst-page-fill"
            className="typst-fill-input"
            type="text"
            value={element.pageFill ?? ''}
            onChange={(event) => onPageFillChange(event.target.value)}
            placeholder="Inherit shared fill"
            spellCheck={false}
          />
        </label>
      </div>
      <div className="box-style-help">
        <p>Top inset adds padding above the first line. Increase it if tall fractions or accents are clipped.</p>
        <button className="styles-button" onClick={onDocumentStyles}><Braces size={15} /> Edit document styles</button>
        <p>Set a shared font size, font, or definition for every text box.</p>
      </div>
      <TypstCodeEditor
        key={documentKey}
        documentKey={documentKey}
        sessions={sessions}
        label="Text & Typst source"
        value={element.source}
        error={element.error}
        languageContext={{ prelude, width: element.width, height: element.height, topInset: element.topInset, pageFill: element.pageFill }}
        onChange={onSourceChange}
        placeholder="Write text or Typst markup…"
        focusRequest={focusRequest}
        footerAction={<button className="icon-button delete-source" onClick={onDelete} title="Delete text box" aria-label="Delete text box"><Trash2 size={15} /></button>}
      />
      <CompileErrors key={`errors:${documentKey}`} error={element.error} />
    </InspectorPanel>
  )
}
