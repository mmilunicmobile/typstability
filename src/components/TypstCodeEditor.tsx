import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { AlignLeft, Keyboard, Search } from 'lucide-react'
import { basicSetup } from 'codemirror'
import { Annotation, Compartment, EditorState, StateEffect, Transaction } from '@codemirror/state'
import { EditorView, keymap, placeholder as editorPlaceholder } from '@codemirror/view'
import { indentWithTab, isolateHistory } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { openSearchPanel } from '@codemirror/search'
import { lintGutter, setDiagnostics } from '@codemirror/lint'
import { typst_lezer, typstLanguageData, typstLezerIndentService, typstLezerListKeymap, typstLezerFoldService } from 'codemirror-lang-typst/lezer'
import { formatTypst } from '../typst/formatter'
import { useTheme } from '../lib/theme'
import { editorThemeOptions, resolveEditorTheme, type EditorThemePreference } from '../lib/editor-theme'
import { editorColorScheme } from '../typst/editor-themes'
import { mapSource, type SourceSection } from '../typst/source'
import { compilerDiagnostics, lspDiagnostics, type LspDiagnostic } from '../typst/diagnostics'
import { TypstLspClient, validateLspUrl } from '../typst/lsp'
import { languageServerExtensions, type LanguageDocument } from '../typst/lsp-editor'
import { lspSettings } from '../typst/lsp-settings'

export type LanguageContext = {
  section?: SourceSection
  prelude?: string
  width?: number
  height?: number
  topInset?: number
  pageFill?: string
}

function languageDocument(value: string, context: LanguageContext | undefined): LanguageDocument {
  const section = context?.section ?? 'source'
  return {
    section,
    wrapped: mapSource(section === 'source' ? value : '', section === 'prelude' ? value : context?.prelude ?? '', context?.width ?? 240, context?.height ?? 120, context?.topInset, context?.pageFill),
  }
}

type EditorSession = { state: EditorState; scrollTop: number }
export type EditorSessions = Map<string, EditorSession>
type Props = {
  documentKey: string
  sessions: EditorSessions
  value: string
  label: string
  placeholder: string
  onChange: (source: string) => void
  error?: string
  languageContext?: LanguageContext
  footerAction?: ReactNode
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
  '.cm-lintRange-error': { textDecoration: 'underline wavy #e5484d', textUnderlineOffset: '3px' },
  '.typst-hover': { padding: '8px 10px', whiteSpace: 'pre-wrap', maxWidth: 'min(440px, 85vw)', maxHeight: '300px', overflow: 'auto' },
})

// Use the parser/editing services without stacking the language's fixed light palette.
const typstLanguage = typst_lezer().language

export function TypstCodeEditor({ documentKey, sessions, value, label, placeholder, onChange, error, languageContext, footerAction }: Props) {
  const { theme, editorTheme, setEditorTheme } = useTheme()
  const selectedTheme = resolveEditorTheme(editorTheme, theme)
  const [colorScheme] = useState(() => new Compartment())
  const [languageService] = useState(() => new Compartment())
  const endpoint = useSyncExternalStore(lspSettings.subscribe, lspSettings.get)
  const [endpointDraft, setEndpointDraft] = useState(endpoint)
  const [connectionRevision, setConnectionRevision] = useState(0)
  const [connectionMessage, setConnectionMessage] = useState('Compiler diagnostics are available without a language server.')
  const client = useRef<TypstLspClient | null>(null)
  const connected = useRef(false)
  const serverDiagnostics = useRef<LspDiagnostic[]>([])
  const mappedDocument = useMemo(() => languageDocument(value, languageContext), [value, languageContext])
  const activeDocument = useRef(mappedDocument)
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const latest = useRef({ value, onChange, selectedTheme, error, languageContext })
  const formatting = useRef(false)
  const [isFormatting, setIsFormatting] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { latest.current = { value, onChange, selectedTheme, error, languageContext } }, [value, onChange, selectedTheme, error, languageContext])

  const refreshDiagnostics = useCallback(() => {
    const view = editor.current
    if (!view) return
    const document = activeDocument.current
    view.dispatch(setDiagnostics(view.state, [
      ...compilerDiagnostics(latest.current.error, document.wrapped, document.section),
      ...lspDiagnostics(serverDiagnostics.current, document.wrapped, document.section),
    ]))
  }, [])

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
      lintGutter(),
      languageService.of([]),
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
        if (update.docChanged) {
          activeDocument.current = languageDocument(update.state.doc.toString(), latest.current.languageContext)
          serverDiagnostics.current = []
          if (connected.current) client.current?.update(activeDocument.current.wrapped.text)
        }
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
  }, [documentKey, sessions, label, placeholder, runFormat, colorScheme, languageService])

  useEffect(() => {
    const view = editor.current
    if (!view || view.state.doc.toString() === value) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
    })
    setMessage('')
  }, [value])

  useEffect(() => {
    const previousText = activeDocument.current.wrapped.text
    activeDocument.current = mappedDocument
    if (previousText !== mappedDocument.wrapped.text) {
      serverDiagnostics.current = []
      if (connected.current) client.current?.update(mappedDocument.wrapped.text)
    }
    refreshDiagnostics()
  }, [mappedDocument, error, refreshDiagnostics])

  useEffect(() => {
    setEndpointDraft(endpoint)
    refreshDiagnostics()
    editor.current?.dispatch({ effects: languageService.reconfigure([]) })
    if (!endpoint) {
      setConnectionMessage('Compiler diagnostics are available without a language server.')
      return
    }
    let cancelled = false
    setConnectionMessage('Connecting to Tinymist…')
    let connection: TypstLspClient
    try {
      connection = new TypstLspClient(endpoint, (diagnostics) => {
        if (cancelled) return
        serverDiagnostics.current = diagnostics
        // didChange can run during a CodeMirror update. Apply markers afterwards.
        queueMicrotask(() => { if (!cancelled) refreshDiagnostics() })
      }, (reason) => {
        if (cancelled) return
        connected.current = false
        serverDiagnostics.current = []
        setConnectionMessage(reason)
        queueMicrotask(() => {
          if (!cancelled) {
            refreshDiagnostics()
            editor.current?.dispatch({ effects: languageService.reconfigure([]) })
          }
        })
      })
    } catch (reason) {
      setConnectionMessage(reason instanceof Error ? reason.message : 'The browser blocked the Tinymist connection.')
      return
    }
    client.current = connection
    const initialText = activeDocument.current.wrapped.text
    void connection.start(documentKey, initialText).then(() => {
      if (cancelled) return
      connected.current = true
      if (activeDocument.current.wrapped.text !== initialText) connection.update(activeDocument.current.wrapped.text)
      editor.current?.dispatch({ effects: languageService.reconfigure(languageServerExtensions(() => connected.current ? client.current : null, () => activeDocument.current)) })
      setConnectionMessage('Tinymist connected · intelligent suggestions and hover enabled.')
    }).catch((reason: unknown) => {
      if (cancelled) return
      setConnectionMessage(reason instanceof Error ? reason.message : 'Could not connect to Tinymist.')
      connection.dispose()
    })
    return () => {
      cancelled = true
      connected.current = false
      client.current = null
      serverDiagnostics.current = []
      connection.dispose()
    }
  }, [endpoint, documentKey, connectionRevision, refreshDiagnostics, languageService])

  useEffect(() => {
    editor.current?.dispatch({ effects: colorScheme.reconfigure(editorColorScheme(selectedTheme)) })
  }, [selectedTheme, colorScheme])

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
      <details className="language-server-settings">
        <summary>Typst intelligence</summary>
        <p>{connectionMessage}</p>
        <p>Run <code>npm run lsp</code> in a local Typstability checkout with Tinymist installed, then paste the bridge URL below. Only Typst source and shared styles are sent to this server.</p>
        <label>Bridge URL<input type="url" value={endpointDraft} onChange={(event) => setEndpointDraft(event.target.value)} placeholder="ws://127.0.0.1:2087/?token=…" spellCheck={false} /></label>
        <div>
          <button type="button" onClick={() => {
            try {
              const validated = validateLspUrl(endpointDraft.trim())
              // A repeated Connect retries a failed connection.
              if (validated === endpoint) setConnectionRevision((revision) => revision + 1)
              else lspSettings.set(validated)
            } catch (reason) { setConnectionMessage(reason instanceof Error ? reason.message : 'Enter a valid bridge URL.') }
          }}>Connect</button>
          <button type="button" disabled={!endpoint} onClick={() => lspSettings.set('')}>Disconnect</button>
        </div>
      </details>
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
