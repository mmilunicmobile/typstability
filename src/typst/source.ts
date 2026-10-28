export const DEFAULT_TYPST_TOP_INSET = 4

export type SourceSection = 'source' | 'prelude'
export type WrappedSource = {
  text: string
  source: { from: number; to: number }
  prelude: { from: number; to: number }
}

// The compiler and language server must see exactly the same wrapper. Keep
// offsets beside its construction so multiline shared styles cannot drift.
export function mapSource(
  source: string,
  prelude: string,
  width: number,
  height: number,
  topInset = DEFAULT_TYPST_TOP_INSET,
  pageFill = '',
): WrappedSource {
  // Keep a sliver of usable content when a box is resized very small.
  const inset = Math.min(Math.max(0, topInset), Math.max(0, height - Math.min(1, height / 2)))
  const head = '#set text(font: "New Computer Modern", size: 12pt)\n#set page(fill: white)\n'
  const middle = `\n#set page(width: ${width}pt, height: ${height}pt, margin: (left: 0pt, right: 0pt, top: ${inset}pt, bottom: 0pt))\n${pageFill.trim() ? `#set page(fill: ${pageFill.trim()})` : ''}\n#block(width: 100%, height: 100%, clip: true)[\n`
  const preludeFrom = head.length
  const sourceFrom = preludeFrom + prelude.length + middle.length
  return {
    text: head + prelude + middle + source + '\n]',
    prelude: { from: preludeFrom, to: preludeFrom + prelude.length },
    source: { from: sourceFrom, to: sourceFrom + source.length },
  }
}

export function wrapSource(...args: Parameters<typeof mapSource>) {
  return mapSource(...args).text
}
