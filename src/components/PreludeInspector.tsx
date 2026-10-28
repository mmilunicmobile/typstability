import { CompileErrors } from './CompileErrors'
import { InspectorPanel } from './InspectorPanel'
import { X } from 'lucide-react'
import { TypstCodeEditor, type EditorSessions } from './TypstCodeEditor'

type Props = {
  source: string
  documentKey: string
  sessions: EditorSessions
  error?: string
  onChange: (source: string) => void
  onClose: () => void
}

export function PreludeInspector({ source, documentKey, sessions, error, onChange, onClose }: Props) {
  return (
    <InspectorPanel label="Shared styles editor">
      <header className="inspector-header">
        <div>
          <strong>Shared styles</strong>
          <span>Applies to every text box</span>
        </div>
        <button className="icon-button" onClick={onClose} title="Close prelude" aria-label="Close prelude">
          <X size={16} />
        </button>
      </header>
      <TypstCodeEditor
        key={documentKey}
        documentKey={documentKey}
        sessions={sessions}
        label="Prelude source"
        value={source}
        error={error}
        languageContext={{ section: 'prelude' }}
        onChange={onChange}
        placeholder={'#let note(body) = block(\n  inset: 8pt,\n  fill: luma(95%),\n  body,\n)'}
      />
      <CompileErrors key={`errors:${documentKey}`} error={error} />
    </InspectorPanel>
  )
}
