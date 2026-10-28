import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlignLeft, Keyboard, Search } from 'lucide-react'
import { basicSetup } from 'codemirror'
import { Annotation, Compartment, EditorState, StateEffect, Transaction } from '@codemirror/state'
import { EditorView, keymap, placeholder as editorPlaceholder } from '@codemirror/view'
import { indentWithTab, isolateHistory } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { openSearchPanel } from '@codemirror/search'
import { typst_lezer, typstLanguageData, typstLezerIndentService, typstLezerListKeymap, typstLezerFoldService, typstLezerLinter } from 'codemirror-lang-typst/lezer'
import { formatTypst } from '../typst/formatter'
import { useTheme } from '../lib/theme'
import { editorThemeOptions, resolveEditorTheme, type EditorThemePreference } from '../lib/editor-theme'
import { editorColorScheme } from '../typst/editor-themes'

type EditorSession = { state: EditorState; scrollTop: number }
export type EditorSessions = Map<string, EditorSession>
type Props = {
  documentKey: string
  sessions: EditorSessions
  value: string
  label: string
  placeholder: string
  onChange: (source: string) => void
  footerAction?: ReactNode
  focusRequest?: number
}

const externalChange = Annotation.define<boolean>()
const editorLayout = EditorView.theme({
  '&': { height: '100%', fontSize: '12px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, monospace', lineHeight: '1.75' },
  '.cm-content': { padding: '12px 0' },
  '.cm-line': { padding: '0 10px' },
  // CodeMirror draws selection behind the text. Opaque active-line colors in
  // third-party themes otherwise cover selections on the cursor's line.
  '.cm-content[data-has-selection="true"] .cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-tooltip': { borderRadius: '6px' },
  '.cm-search': { whiteSpace: 'normal' },
  '.cm-search input': { maxWidth: '145px' },
})

// Use the parser/editing services without stacking the language's fixed light palette.
const typstLanguage = typst_lezer().language

export function TypstCodeEditor({ documentKey, sessions, value, label, placeholder, onChange, footerAction, focusRequest }: Props) {
  const { theme, editorTheme, setEditorTheme } = useTheme()
  const selectedTheme = resolveEditorTheme(editorTheme, theme)
  const [colorScheme] = useState(() => new Compartment())
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const latest = useRef({ value, onChange, selectedTheme })
  const formatting = useRef(false)
  const [isFormatting, setIsFormatting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { latest.current = { value, onChange, selectedTheme } }, [value, onChange, selectedTheme])

  const runFormat = useCallback(async () => {
    const view = editor.current
    if (!view || formatting.current) return
    const original = view.state.doc
    formatting.current = true
    setIsFormatting(true)
    setMessage('')
    try {
      const formatted = await formatTypst(original.toString())
      if (editor.current !== view) return
      if (view.state.doc !== original) {
        setMessage('Text changed while formatting. Run Format again.')
        return
      }
      if (formatted !== original.toString()) {
        view.dispatch({
          changes: { from: 0, to: original.length, insert: formatted },
          selection: { anchor: Math.min(view.state.selection.main.head, formatted.length) },
          annotations: [Transaction.userEvent.of('input.format'), isolateHistory.of('full')],
        })
      }
      setMessage('Formatted.')
      view.focus()
    } catch {
      if (editor.current === view) setMessage('Could not format. Check for incomplete Typst syntax, then try again.')
    } finally {
      formatting.current = false
      if (editor.current === view) setIsFormatting(false)
    }
  }, [])

  useEffect(() => {
    if (!host.current) return
    const extensions = [
      basicSetup,
      typstLanguage,
      typstLezerIndentService,
      typstLezerListKeymap,
      typstLezerFoldService,
      typstLezerLinter,
      // Typst uses double quotes for strings; apostrophes in prose should stay single.
      typstLanguageData.of({ closeBrackets: { brackets: ['(', '[', '{', '"'] } }),
      indentUnit.of('  '),
      EditorView.lineWrapping,
      editorLayout,
      colorScheme.of(editorColorScheme(latest.current.selectedTheme)),
      editorPlaceholder(placeholder),
      EditorView.contentAttributes.of((view) => ({
        'aria-label': label,
        spellcheck: 'false',
        'data-has-selection': String(view.state.selection.ranges.some((range) => !range.empty)),
      })),
      keymap.of([
        { key: 'Shift-Alt-f', run: () => { void runFormat(); return true } },
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !update.transactions.every((transaction) => transaction.annotation(externalChange))) {
          latest.current.onChange(update.state.doc.toString())
          setMessage('')
        }
      }),
    ]
    const saved = sessions.get(documentKey)
    const state = saved && saved.state.doc.toString() === latest.current.value
      ? saved.state.update({ effects: StateEffect.reconfigure.of(extensions) }).state
      : EditorState.create({ doc: latest.current.value, extensions })
    const view = new EditorView({ state, parent: host.current })
    editor.current = view
    if (saved) view.scrollDOM.scrollTop = saved.scrollTop
    return () => {
      sessions.set(documentKey, { state: view.state, scrollTop: view.scrollDOM.scrollTop })
      // Bound retained editor histories for documents with many annotations.
      if (sessions.size > 100) sessions.delete(sessions.keys().next().value!)
      editor.current = null
      view.destroy()
    }
  }, [documentKey, sessions, label, placeholder, runFormat, colorScheme])

  useEffect(() => {
    if (focusRequest !== undefined) editor.current?.focus()
  }, [focusRequest])

  useEffect(() => {
    editor.current?.dispatch({ effects: colorScheme.reconfigure(editorColorScheme(selectedTheme)) })
  }, [selectedTheme, colorScheme])

  useEffect(() => {
    const view = editor.current
    if (!view || view.state.doc.toString() === value) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
    })
    setMessage('')
  }, [value])

  return (
    <div className="typst-code-editor">
      <div className="source-toolbar">
        <select className="source-theme" aria-label="Editor theme" title="Editor theme" value={editorTheme} onChange={(event) => setEditorTheme(event.target.value as EditorThemePreference)}>
          {editorThemeOptions.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
        </select>
        <div className="source-actions">
          <button type="button" className="icon-button" aria-label="Find in source" title="Find / replace (Ctrl/Cmd+F)" onClick={() => { if (editor.current) openSearchPanel(editor.current) }}><Search size={15} /></button>
          <button type="button" className="format-button" disabled={isFormatting} onClick={() => void runFormat()} title="Format source (Shift+Alt+F)"><AlignLeft size={15} />{isFormatting ? 'Formatting…' : 'Format'}</button>
        </div>
      </div>
      <div className="source-editor" ref={host} />
      <div className="source-footer">
        <span className="source-status" role="status">{message || 'Live preview'}</span>
        <details className="source-shortcuts">
          <summary aria-label="Editor keyboard shortcuts" title="Keyboard shortcuts"><Keyboard size={16} /></summary>
          <div>
            <strong>Keyboard shortcuts</strong>
            <dl>
              <dt>Suggestions</dt><dd>Ctrl + Space</dd>
              <dt>Find / replace</dt><dd>Ctrl / ⌘ + F</dd>
              <dt>Format</dt><dd>Shift + Alt + F</dd>
              <dt>Leave editor</dt><dd>Esc, then Tab</dd>
            </dl>
          </div>
        </details>
        {footerAction}
      </div>
    </div>
  )
}
