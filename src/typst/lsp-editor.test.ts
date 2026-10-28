import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { currentCompletions, nextSnippetField, startCompletion } from '@codemirror/autocomplete'
import { history, undo } from '@codemirror/commands'
import { languageServerExtensions, snippetTemplate } from './lsp-editor'
import { mapSource } from './source'
import { positionAt } from './diagnostics'
import type { TypstLspClient } from './lsp'

const views: EditorView[] = []
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(() => { views.forEach((view) => view.destroy()); views.length = 0 })

function editor(source = '#loc') {
  const wrapped = mapSource(source, '#let local_answer = 42', 100, 50)
  const document = { wrapped, section: 'source' as const }
  const complete = vi.fn().mockResolvedValue({ items: [{
    label: 'local_answer', detail: '42',
    textEdit: { range: { start: positionAt(wrapped.text, wrapped.source.from + source.lastIndexOf('#') + 1), end: positionAt(wrapped.text, wrapped.source.to) }, newText: 'local_answer' },
  }] })
  const client = { complete, completionTriggers: ['#', '.'] } as unknown as TypstLspClient
  const view = new EditorView({ state: EditorState.create({ doc: source, selection: { anchor: source.length }, extensions: [history(), languageServerExtensions(() => client, () => document)] }) })
  views.push(view)
  return { view, complete, wrapped }
}

it('requests completions at wrapped positions and applies the server replacement as an edit', async () => {
  const { view, complete, wrapped } = editor()
  startCompletion(view)
  await waitFor(() => expect(currentCompletions(view.state)).toHaveLength(1))
  expect(complete).toHaveBeenCalledWith(positionAt(wrapped.text, wrapped.source.to), undefined)
  const completion = currentCompletions(view.state)[0]
  expect(completion.label).toBe('local_answer')
  if (typeof completion.apply !== 'function') throw new Error('Expected a server edit')
  completion.apply(view, completion, 1, 4)
  expect(view.state.doc.toString()).toBe('#local_answer')
  expect(view.state.selection.main.head).toBe('#local_answer'.length)
})

it('does not apply a stale completion after the source changes', async () => {
  const { view } = editor()
  startCompletion(view)
  await waitFor(() => expect(currentCompletions(view.state)).toHaveLength(1))
  const completion = currentCompletions(view.state)[0]
  view.dispatch({ changes: { from: 4, insert: 'x' } })
  if (typeof completion.apply !== 'function') throw new Error('Expected a server edit')
  completion.apply(view, completion, 1, 4)
  expect(view.state.doc.toString()).toBe('#locx')
})

it('applies real function snippets, additional edits, selection and tab stops in one undo step', async () => {
  const source = '#let a = 1\n#loc'
  const { view, complete, wrapped } = editor(source)
  const range = (from: number, to: number) => ({ start: positionAt(wrapped.text, wrapped.source.from + from), end: positionAt(wrapped.text, wrapped.source.from + to) })
  complete.mockResolvedValue({ items: [{ label: 'text', insertTextFormat: 2,
    textEdit: { range: range(source.lastIndexOf('#') + 1, source.length), newText: 'text(${1:body}, fill: ${2:red})$0' },
    additionalTextEdits: [{ range: range(0, '#let a = 1'.length), newText: '#let a = 2' }],
  }] })
  startCompletion(view)
  await waitFor(() => expect(currentCompletions(view.state)).toHaveLength(1))
  const completion = currentCompletions(view.state)[0]
  if (typeof completion.apply !== 'function') throw new Error('Expected a snippet')
  completion.apply(view, completion, source.lastIndexOf('#') + 1, source.length)
  expect(view.state.doc.toString()).toBe('#let a = 2\n#text(body, fill: red)')
  expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('body')
  expect(nextSnippetField(view)).toBe(true)
  expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('red')
  expect(undo(view)).toBe(true)
  expect(view.state.doc.toString()).toBe(source)
})

it('translates tabstops while preserving literal Typst braces and omitting unsupported transforms', () => {
  expect(snippetTemplate('f($1, ${2:x})$0')).toBe('f(${1}, ${2:x})${0}')
  expect(snippetTemplate('{ ${1:} }')).toBe('\\{ ${1:} \\}')
  expect(snippetTemplate('${1/foo/bar/}')).toBeNull()
  expect(snippetTemplate('$TM_SELECTED_TEXT')).toBeNull()
})
