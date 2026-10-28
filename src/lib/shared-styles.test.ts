import { describe, expect, it } from 'vitest'
import { setSharedFontSize, sharedFontSize } from './shared-styles'

describe('shared font size control', () => {
  it('appends a rule after user definitions and replaces only its trailing standalone rule', () => {
    const source = '#let title = [Hello]\n#set text(font: "Example", size: 18pt)'
    const smaller = setSharedFontSize(source, 10)
    expect(smaller).toBe(`${source}\n#set text(size: 10pt)`)
    expect(sharedFontSize(smaller)).toBe(10)
    expect(setSharedFontSize(smaller, 9.5)).toBe(`${source}\n#set text(size: 9.5pt)`)
  })
  it('supports blank styles and rejects invalid values', () => {
    expect(setSharedFontSize('', 11)).toBe('#set text(size: 11pt)')
    expect(sharedFontSize('')).toBeUndefined()
    for (const size of [0, -1, 201, NaN, Infinity]) expect(setSharedFontSize('hello', size)).toBe('hello')
  })
})
