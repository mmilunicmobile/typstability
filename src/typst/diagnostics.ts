import type { Diagnostic } from '@codemirror/lint'
import type { SourceSection, WrappedSource } from './source'

export type Position = { line: number; character: number }
export type LspRange = { start: Position; end: Position }
export type LspDiagnostic = { range: LspRange; severity?: number; message: string; source?: string }

export function offsetAt(text: string, position: Position, encoding: 'utf-16' | 'unicode' = 'utf-16') {
  if (position.line < 0 || position.character < 0) return null
  let from = 0
  for (let line = 0; line < position.line; line++) {
    const next = text.indexOf('\n', from)
    if (next < 0) return null
    from = next + 1
  }
  const end = text.indexOf('\n', from)
  const line = text.slice(from, end < 0 ? text.length : end).replace(/\r$/, '')
  const column = encoding === 'unicode'
    ? Array.from(line).slice(0, position.character).join('').length
    : Math.min(position.character, line.length)
  return from + column
}

export function positionAt(text: string, offset: number): Position {
  const head = text.slice(0, offset)
  const line = head.split('\n').length - 1
  return { line, character: offset - (head.lastIndexOf('\n') + 1) }
}

export function visibleRange(wrapped: WrappedSource, section: SourceSection, range: LspRange, encoding: 'utf-16' | 'unicode' = 'utf-16') {
  const from = offsetAt(wrapped.text, range.start, encoding)
  const to = offsetAt(wrapped.text, range.end, encoding)
  const bounds = wrapped[section]
  // Diagnostics in generated settings, shared styles, or imported packages must
  // never be clamped onto unrelated text in the active editor.
  if (from === null || to === null || from < bounds.from || from > bounds.to || to < from) return null
  return { from: from - bounds.from, to: Math.min(to, bounds.to) - bounds.from }
}

function markRange(from: number, to: number, text: string) {
  // Point diagnostics still need a visible squiggle. CodeMirror renders an EOF
  // diagnostic as a point marker, without shifting it onto the previous token.
  const next = text.codePointAt(from)
  return { from, to: Math.max(to, Math.min(text.length, from + (next !== undefined && next > 0xffff ? 2 : 1))) }
}

export function lspDiagnostics(diagnostics: LspDiagnostic[], wrapped: WrappedSource, section: SourceSection): Diagnostic[] {
  const text = wrapped.text.slice(wrapped[section].from, wrapped[section].to)
  return diagnostics.flatMap((diagnostic) => {
    const range = visibleRange(wrapped, section, diagnostic.range)
    return range ? [{
      ...markRange(range.from, range.to, text),
      severity: diagnostic.severity === 2 ? 'warning' : diagnostic.severity === 3 || diagnostic.severity === 4 ? 'info' : 'error',
      message: diagnostic.message,
      source: diagnostic.source || 'Tinymist',
    } satisfies Diagnostic] : []
  })
}

export function compilerDiagnostics(error: string | undefined, wrapped: WrappedSource, section: SourceSection): Diagnostic[] {
  if (!error) return []
  const diagnostics: Diagnostic[] = []
  // The bundled compiler emits Unicode scalar columns (not UTF-16). Full
  // diagnostics retain the end range; older point-only messages also work.
  const pattern = /(?:^|\n)(?:[^:\n]+: )?\/?(?:preview|export)\.typ:(\d+):(\d+)(?:-(\d+):(\d+))?:\s*(error|warning):\s*([^\n]*)/g
  for (const match of error.matchAll(pattern)) {
    const start = { line: Number(match[1]) - 1, character: Number(match[2]) - 1 }
    const end = match[3] ? { line: Number(match[3]) - 1, character: Number(match[4]) - 1 } : start
    const range = visibleRange(wrapped, section, { start, end }, 'unicode')
    if (!range) continue
    const text = wrapped.text.slice(wrapped[section].from, wrapped[section].to)
    diagnostics.push({ ...markRange(range.from, range.to, text), severity: match[5] === 'warning' ? 'warning' : 'error', message: match[6], source: 'Typst compiler' })
  }
  return diagnostics
}

export type CompilerDiagnostic = { package: string; path: string; severity: string; range: string; message: string }

export function formatCompilerDiagnostics(diagnostics: CompilerDiagnostic[] | undefined) {
  return (diagnostics ?? []).map((diagnostic) => {
    const range = /^(\d+):(\d+)-(\d+):(\d+)$/.exec(diagnostic.range)
    const location = range ? `${Number(range[1]) + 1}:${Number(range[2]) + 1}-${Number(range[3]) + 1}:${Number(range[4]) + 1}:` : ''
    return `${diagnostic.package ? diagnostic.package + '@' : ''}${diagnostic.path}:${location} ${diagnostic.severity}: ${diagnostic.message}`
  }).join('\n')
}
