// A trailing standalone rule keeps the quick control in the same source of
// truth as advanced Typst styles. Other user definitions remain untouched.
const trailingSizeRule = /(?:^|\n)#set text\(size: (\d+(?:\.\d+)?)pt\)\s*$/

export function sharedFontSize(source: string): number | undefined {
  const match = source.match(trailingSizeRule)
  return match ? Number(match[1]) : undefined
}

export function setSharedFontSize(source: string, size: number): string {
  if (!Number.isFinite(size) || size < 1 || size > 200) return source
  const rule = `#set text(size: ${size}pt)`
  const previous = source.match(trailingSizeRule)
  const prefix = previous ? source.slice(0, previous.index).trimEnd() : source.trimEnd()
  return `${prefix ? `${prefix}\n` : ''}${rule}`
}
