import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { CompileErrors } from './CompileErrors'

afterEach(cleanup)

it('starts collapsed, counts diagnostic headers rather than hints, and retains the open state while typing', () => {
  const first = 'incremental compile: /preview.typ:19:1: error: unknown variable: sdf\nhints: if you meant text, use quotes\nThis hint mentions error: without being a diagnostic.'
  const second = '\n/preview.typ:22:3: error: expected expression'
  const view = render(<CompileErrors error={first} />)
  const details = view.container.querySelector('details')!
  expect(details.open).toBe(false)
  expect(screen.getByLabelText('1 error')).toHaveTextContent('Errors1')
  view.rerender(<CompileErrors error={first + second} />)
  expect(details.open).toBe(false)
  fireEvent.click(screen.getByLabelText('2 errors'))
  expect(details.open).toBe(true)
  expect(view.container.querySelector('pre')).toHaveTextContent('expected expression')
  view.rerender(<CompileErrors error={first} />)
  expect(details.open).toBe(true)
  fireEvent.click(screen.getByLabelText('1 error'))
  expect(details.open).toBe(false)
})

it('keeps the same collapsed row at zero with neutral styling as errors appear and clear', () => {
  const view = render(<CompileErrors />)
  const details = view.container.querySelector('details')!
  expect(screen.getByLabelText('0 errors')).toHaveTextContent('Errors0')
  expect(details).not.toHaveClass('has-errors')
  expect(details.open).toBe(false)
  view.rerender(<CompileErrors error="initialize runtime: Could not load bundled font" />)
  expect(screen.getByLabelText('1 error')).toBeInTheDocument()
  expect(details).toHaveClass('has-errors')
  view.rerender(<CompileErrors />)
  expect(view.container.querySelector('details')).toBe(details)
  expect(details.open).toBe(false)
  expect(screen.getByLabelText('0 errors')).toBeInTheDocument()
  expect(details).not.toHaveClass('has-errors')
})

it('preserves an expanded disclosure when errors clear and return', () => {
  const view = render(<CompileErrors error="incremental compile: incomplete input" />)
  fireEvent.click(screen.getByLabelText('1 error'))
  view.rerender(<CompileErrors />)
  expect(view.container.querySelector('details')!.open).toBe(true)
  expect(screen.getByText('No errors.')).toBeInTheDocument()
  view.rerender(<CompileErrors error="incremental compile: incomplete input" />)
  expect(view.container.querySelector('details')!.open).toBe(true)
})

it('counts compiler diagnostics with end ranges', () => {
  render(<CompileErrors error={'incremental compile: /preview.typ:7:2-7:10: error: unknown variable\n/preview.typ:8:1-8:5: error: expected expression'} />)
  expect(screen.getByLabelText('2 errors')).toBeInTheDocument()
})
