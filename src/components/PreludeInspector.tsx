import { X } from 'lucide-react'

type Props = {
  source: string
  error?: string
  onChange: (source: string) => void
  onClose: () => void
}

export function PreludeInspector({ source, error, onChange, onClose }: Props) {
  return (
    <aside className="inspector">
      <header className="inspector-header">
        <div>
          <strong>Prelude</strong>
          <span>Shared by every Typst box</span>
        </div>
        <button className="icon-button" onClick={onClose} title="Close prelude" aria-label="Close prelude">
          <X size={16} />
        </button>
      </header>
      {error && <div className="compile-error">{error}</div>}
      <label className="source-label" htmlFor="typst-prelude">Prelude source</label>
      <textarea
        id="typst-prelude"
        className="source-editor"
        value={source}
        onChange={(event) => onChange(event.target.value)}
        placeholder={'#let note(body) = block(\n  inset: 8pt,\n  fill: luma(95%),\n  body,\n)'}
        spellCheck={false}
      />
      <div className="inspector-footer">
        <span>Definitions and styles compile locally.</span>
      </div>
    </aside>
  )
}
