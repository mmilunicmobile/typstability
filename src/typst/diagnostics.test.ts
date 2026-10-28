import { describe, expect, it } from 'vitest'
import { compilerDiagnostics, formatCompilerDiagnostics, lspDiagnostics, offsetAt, positionAt, visibleRange } from './diagnostics'
import { mapSource, wrapSource } from './source'
import { completionEdits } from './lsp-editor'

function compilerLocation(text: string, offset: number) {
  const head = text.slice(0, offset)
  const line = head.split('\n').length
  const column = Array.from(head.slice(head.lastIndexOf('\n') + 1)).length + 1
  return `${line}:${column}`
}

describe('compiler and language server source mapping', () => {
  it('uses exactly the compiler wrapper and maps both multiline source sections', () => {
    const args = ['First\n#brand', '#let brand = red\n#let second = 2\n', 120, 80, 3, 'none'] as const
    const mapped = mapSource(...args)
    expect(mapped.text).toBe(wrapSource(...args))
    expect(mapped.text.slice(mapped.prelude.from, mapped.prelude.to)).toBe(args[1])
    expect(mapped.text.slice(mapped.source.from, mapped.source.to)).toBe(args[0])
    const range = { start: positionAt(mapped.text, mapped.source.from + 7), end: positionAt(mapped.text, mapped.source.to) }
    expect(visibleRange(mapped, 'source', range)).toEqual({ from: 7, to: args[0].length })
    expect(visibleRange(mapped, 'prelude', range)).toBeNull()
  })

  it('maps Unicode scalar compiler columns and UTF-16 language server columns separately', () => {
    const mapped = mapSource('🧪 café #unknown', '#let x = 1\n#let y = 2', 100, 50)
    const from = mapped.source.from + '🧪 café #'.length
    const to = from + 'unknown'.length
    const error = `incremental compile: /preview.typ:${compilerLocation(mapped.text, from)}-${compilerLocation(mapped.text, to)}: error: unknown variable: unknown`
    expect(compilerDiagnostics(error, mapped, 'source')).toEqual([{ from: 9, to: 16, severity: 'error', message: 'unknown variable: unknown', source: 'Typst compiler' }])
    expect(lspDiagnostics([{ range: { start: positionAt(mapped.text, from), end: positionAt(mapped.text, to) }, message: 'Unknown' }], mapped, 'source')[0]).toMatchObject({ from: 9, to: 16 })
  })

  it('maps shared-style errors without marking a text box or generated settings', () => {
    const mapped = mapSource('Hello', '#let x = missing\n#let y = 2', 100, 50)
    const from = mapped.prelude.from + '#let x = '.length
    const error = `/preview.typ:${compilerLocation(mapped.text, from)}: error: unknown variable: missing\n/preview.typ:1:1: error: generated setting failed`
    expect(compilerDiagnostics(error, mapped, 'prelude')).toHaveLength(1)
    expect(compilerDiagnostics(error, mapped, 'prelude')[0]).toMatchObject({ from: 9, to: 10 })
    expect(compilerDiagnostics(error, mapped, 'source')).toEqual([])
    expect(compilerDiagnostics('/package.typ:7:1: error: imported error', mapped, 'source')).toEqual([])
    expect(compilerDiagnostics('/package/preview.typ:7:1: error: imported error', mapped, 'source')).toEqual([])
    expect(compilerDiagnostics('initialize runtime: failed to load compiler', mapped, 'source')).toEqual([])
  })

  it('keeps EOF diagnostics at EOF and formats full compiler diagnostics with end positions', () => {
    const mapped = mapSource('#let x = (', '', 100, 50)
    const location = compilerLocation(mapped.text, mapped.source.to)
    expect(compilerDiagnostics(`/preview.typ:${location}: error: expected )`, mapped, 'source')[0]).toMatchObject({ from: 10, to: 10 })
    expect(formatCompilerDiagnostics([{ package: '', path: '/preview.typ', range: '6:2-6:5', severity: 'error', message: 'bad' }])).toBe('/preview.typ:7:3-7:6: error: bad')
  })

  it('handles CRLF lines, non-BMP text, and invalid line numbers', () => {
    const text = 'x\r\n🧪z'
    expect(offsetAt(text, { line: 1, character: 2 })).toBe(5)
    expect(offsetAt(text, { line: 1, character: 1 }, 'unicode')).toBe(5)
    expect(offsetAt(text, { line: 20, character: 1 })).toBeNull()
    expect(offsetAt(text, { line: -1, character: 1 })).toBeNull()
  })
})

describe('completion source edits', () => {
  it('maps server text edits and additional edits into one visible document', () => {
    const wrapped = mapSource('#let local = 1\n#loc', '#let shared = 42', 100, 50)
    const range = (from: number, to: number) => ({ start: positionAt(wrapped.text, wrapped.source.from + from), end: positionAt(wrapped.text, wrapped.source.from + to) })
    expect(completionEdits({ label: 'local', textEdit: { range: range(16, 19), newText: 'local' }, additionalTextEdits: [{ range: range(5, 10), newText: 'renamed' }] }, { wrapped, section: 'source' }, 16, 19)).toEqual({
      changes: [{ from: 16, to: 19, insert: 'local' }, { from: 5, to: 10, insert: 'renamed' }], main: { from: 16, to: 19, insert: 'local' },
    })
  })

  it('rejects edits to hidden styles, overlapping edits, and unsupported complex snippets', () => {
    const wrapped = mapSource('#foo', '#let shared = 42', 100, 50)
    const styleRange = { start: positionAt(wrapped.text, wrapped.prelude.from), end: positionAt(wrapped.text, wrapped.prelude.to) }
    const sourceRange = { start: positionAt(wrapped.text, wrapped.source.from), end: positionAt(wrapped.text, wrapped.source.to) }
    const document = { wrapped, section: 'source' as const }
    expect(completionEdits({ label: 'foo', additionalTextEdits: [{ range: styleRange, newText: 'Oops' }] }, document, 1, 4)).toBeNull()
    expect(completionEdits({ label: 'foo', additionalTextEdits: [{ range: sourceRange, newText: 'Overlap' }] }, document, 1, 4)).toBeNull()
    expect(completionEdits({ label: 'foo', insertTextFormat: 2, insertText: '${TM_SELECTED_TEXT}' }, document, 1, 4)).toBeNull()
    const acrossWrapper = { start: positionAt(wrapped.text, wrapped.source.from + 1), end: positionAt(wrapped.text, wrapped.text.length) }
    expect(completionEdits({ label: 'foo', textEdit: { range: acrossWrapper, newText: 'bad' } }, document, 1, 4)).toBeNull()
  })
})
