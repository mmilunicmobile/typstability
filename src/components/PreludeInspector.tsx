import { CompileErrors } from './CompileErrors'
import { InspectorPanel } from './InspectorPanel'
import { X } from 'lucide-react'
import { DEFAULT_TYPST_TOP_INSET } from '../typst/source'
import { setSharedFontSize, sharedFontSize } from '../lib/shared-styles'
import { TypstCodeEditor, type EditorSessions } from './TypstCodeEditor'

type Props = {
  source: string
  documentKey: string
  sessions: EditorSessions
  defaultTopInset: number
  onDefaultTopInsetChange: (value: number) => void
  onApplyPadding: () => void
  error?: string
  onChange: (source: string) => void
  onClose: () => void
}

export function PreludeInspector({ source, documentKey, sessions, defaultTopInset, onDefaultTopInsetChange, onApplyPadding, error, onChange, onClose }: Props) {
  return (
    <InspectorPanel label="Document styles editor">
      <header className="inspector-header">
        <div>
          <strong>Document styles</strong>
          <span>Fonts, padding, and definitions for all text boxes</span>
        </div>
        <button className="icon-button" onClick={onClose} title="Close document styles" aria-label="Close document styles">
          <X size={16} />
        </button>
      </header>
      <div className="document-style-controls">
        <label htmlFor="document-font-size">Font size for all text boxes
          <span className="style-number-input"><input id="document-font-size" type="number" min="1" max="200" step="0.5"
            value={sharedFontSize(source) ?? (source.trim() ? '' : 12)} placeholder="From styles"
            onChange={(event) => { if (event.target.value) onChange(setSharedFontSize(source, Number(event.target.value))) }} /> pt</span>
        </label>
        <p>Updates Shared styles below. Individual text boxes can override these styles.</p>
        <label htmlFor="document-box-padding">Top padding for new text boxes
          <span className="style-number-input"><input id="document-box-padding" type="number" min="0" max="200" step="1"
            value={defaultTopInset ?? DEFAULT_TYPST_TOP_INSET}
            onChange={(event) => {
              if (!event.target.value) return
              const value = Number(event.target.value)
              if (Number.isFinite(value)) onDefaultTopInsetChange(Math.max(0, Math.min(200, value)))
            }} /> pt</span>
        </label>
        <p>A small top margin protects tall first-line fractions and accents. Each box also has its own Top inset control.</p>
        <button className="styles-button" onClick={onApplyPadding}>Apply padding to all existing text boxes</button>
      </div>
      <TypstCodeEditor
        key={documentKey}
        documentKey={documentKey}
        sessions={sessions}
        label="Shared styles source"
        value={source}
        onChange={onChange}
        placeholder={'#set text(font: "New Computer Modern", size: 10pt)\n\n#let note(body) = block(\n  inset: 8pt,\n  fill: luma(95%),\n  body,\n)'}
      />
      <CompileErrors key={`errors:${documentKey}`} error={error} />
    </InspectorPanel>
  )
}
