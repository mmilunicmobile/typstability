import { describe, expect, it } from 'vitest'
import { pdfColor } from './color'

describe('pdfColor', () => {
  it('converts six-digit hex colors to PDF rgb values', () => {
    const color = pdfColor('#ff8040')
    expect(color.red).toBeCloseTo(1)
    expect(color.green).toBeCloseTo(128 / 255)
    expect(color.blue).toBeCloseTo(64 / 255)
  })

  it('expands shorthand hex colors', () => {
    const color = pdfColor('#0af')
    expect(color.red).toBeCloseTo(0)
    expect(color.green).toBeCloseTo(170 / 255)
    expect(color.blue).toBeCloseTo(1)
  })
})
