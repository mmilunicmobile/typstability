import { autocompletion, snippet, type Completion, type CompletionContext } from '@codemirror/autocomplete'
import type { Transaction } from '@codemirror/state'
import { hoverTooltip } from '@codemirror/view'
import { offsetAt, positionAt, visibleRange, type LspRange } from './diagnostics'
import { hoverText, type CompletionItem, type TypstLspClient } from './lsp'
import type { SourceSection, WrappedSource } from './source'

export type LanguageDocument = { wrapped: WrappedSource; section: SourceSection }

// Tinymist uses TextMate tab stops for function arguments. CodeMirror supports
// the same numbered placeholders but requires the short $1 form to be expanded.
// Omit complex variable/transform snippets rather than insert their syntax.
export function snippetTemplate(text: string): string | null {
  let template = ''
  for (let index = 0; index < text.length;) {
    const char = text[index]
    if (char === '$') {
      const placeholder = /^\$(?:(\d+)|\{(\d+)(?::([^{}]*))?\})/.exec(text.slice(index))
      if (placeholder) {
        const value = placeholder[3]
        if (value && /\$[\d{A-Za-z_]/.test(value)) return null
        template += '${' + (placeholder[1] ?? placeholder[2]) + (value !== undefined ? ':' + value : '') + '}'
        index += placeholder[0].length
        continue
      }
      if (/[{A-Za-z_]/.test(text[index + 1] ?? '')) return null
    }
    if (char === '\\' && /[$\\}]/.test(text[index + 1] ?? '')) {
      const literal = text[++index]
      template += literal === '}' ? '\\}' : literal
    } else template += char === '{' || char === '}' ? '\\' + char : char
    index++
  }
  return template
}

// Completion edits are all relative to the original server document. Reject
// edits outside the visible source or overlapping edits as one unit.
export function completionEdits(item: CompletionItem, document: LanguageDocument, from: number, to: number) {
  const mapEdit = (range: LspRange) => {
    const end = offsetAt(document.wrapped.text, range.end)
    if (end === null || end > document.wrapped[document.section].to) return null
    return visibleRange(document.wrapped, document.section, range)
  }
  const edit = item.textEdit
  const range = edit ? mapEdit('range' in edit ? edit.range : edit.replace) : { from, to }
  if (!range) return null
  const changes = [{ ...range, insert: edit?.newText ?? item.insertText ?? item.label }]
  const template = item.insertTextFormat === 2 ? snippetTemplate(changes[0].insert) : undefined
  if (template === null) return null
  for (const additional of item.additionalTextEdits ?? []) {
    const mapped = mapEdit(additional.range)
    if (!mapped) return null
    changes.push({ ...mapped, insert: additional.newText })
  }
  const sorted = [...changes].sort((a, b) => a.from - b.from || a.to - b.to)
  if (sorted.some((change, index) => index > 0 && (change.from < sorted[index - 1].to || change.from === sorted[index - 1].from))) return null
  return { changes, main: changes[0], ...(template !== undefined ? { template } : {}) }
}

const completionTypes: Record<number, string> = { 2: 'method', 3: 'function', 4: 'constructor', 5: 'property', 6: 'variable', 7: 'class', 9: 'namespace', 10: 'property', 12: 'value', 13: 'enum', 14: 'keyword', 15: 'text', 21: 'constant' }

export function languageServerExtensions(getClient: () => TypstLspClient | null, getDocument: () => LanguageDocument) {
  const complete = async (context: CompletionContext) => {
    const client = getClient()
    if (!client) return null
    const document = getDocument()
    const original = context.state.doc
    const word = context.matchBefore(/[\p{L}\p{N}_-]*/u)
    const previous = context.pos ? context.state.sliceDoc(context.pos - 1, context.pos) : ''
    const trigger = client.completionTriggers.includes(previous) ? previous : undefined
    if (!context.explicit && !trigger && !word?.text) return null
    const from = word?.from ?? context.pos
    try {
      const result = await client.complete(positionAt(document.wrapped.text, document.wrapped[document.section].from + context.pos), trigger)
      if (context.aborted || getClient() !== client || getDocument().wrapped.text !== document.wrapped.text) return null
      const items = Array.isArray(result) ? result : result?.items ?? []
      const options: Completion[] = items
        .sort((a, b) => (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label))
        .flatMap((item) => {
          const edits = completionEdits(item, document, from, context.pos)
          if (!edits) return []
          return [{
            label: item.label,
            type: item.kind ? completionTypes[item.kind] : undefined,
            detail: item.detail,
            info: typeof item.documentation === 'string' ? item.documentation : item.documentation?.value,
            apply(view) {
              if (view.state.doc !== original || getClient() !== client || getDocument().wrapped.text !== document.wrapped.text) return
              if (edits.template !== undefined) {
                snippet(edits.template)({
                  state: view.state,
                  dispatch(transaction: Transaction) {
                    const additional = edits.changes.slice(1).map((change) => ({
                      from: transaction.changes.mapPos(change.from, 1),
                      to: transaction.changes.mapPos(change.to, change.from === change.to ? 1 : -1),
                      insert: change.insert,
                    }))
                    view.dispatch(view.state.update({ changes: transaction.changes, selection: transaction.selection, effects: transaction.effects, userEvent: 'input.complete' }, { changes: additional, sequential: true }))
                  },
                }, null, edits.main.from, edits.main.to)
                return
              }
              const changes = view.state.changes(edits.changes)
              view.dispatch({ changes, selection: { anchor: changes.mapPos(edits.main.from, -1) + edits.main.insert.length }, userEvent: 'input.complete' })
            },
          } satisfies Completion]
        })
      return { from, options, filter: false }
    } catch { return null }
  }
  return [
    autocompletion({ override: [complete] }),
    hoverTooltip(async (view, pos) => {
      const client = getClient()
      if (!client) return null
      const document = getDocument()
      const original = view.state.doc
      try {
        const hover = await client.hover(positionAt(document.wrapped.text, document.wrapped[document.section].from + pos))
        if (!hover || view.state.doc !== original || getClient() !== client || getDocument().wrapped.text !== document.wrapped.text) return null
        const range = hover.range ? visibleRange(document.wrapped, document.section, hover.range) : { from: pos, to: pos }
        if (!range) return null
        return {
          pos: range.from,
          end: range.to,
          create() {
            const dom = window.document.createElement('div')
            dom.className = 'typst-hover'
            dom.textContent = hoverText(hover.contents)
            return { dom }
          },
        }
      } catch { return null }
    }),
  ]
}
