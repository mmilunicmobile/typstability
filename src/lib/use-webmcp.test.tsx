import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWebMcp, type WebMcpTool } from './use-webmcp'
import type { EditorDocument } from '../types'

const documentValue: EditorDocument = { name: 'Test', prelude: '', originalPdf: null, updatedAt: 0,
  pages: [{ id: 'page', sourceIndex: null, width: 612, height: 792, elements: [] }] }
function mount() {
  return renderHook(() => useWebMcp({ active: true, document: documentValue, projectId: 'test', selection: null, onEdit: vi.fn() }))
}
afterEach(() => {
  cleanup()
  delete (document as Document & { modelContext?: unknown }).modelContext
  delete (navigator as Navigator & { modelContext?: unknown }).modelContext
})

describe('WebMCP browser lifecycle', () => {
  it('revokes a partial registration if the browser rejects a tool', async () => {
    const signals: AbortSignal[] = []
    let readTool: WebMcpTool | undefined
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      registerTool: (tool: WebMcpTool, options: { signal: AbortSignal }) => {
        signals.push(options.signal)
        if (tool.name === 'typstability_edit_session') return Promise.reject(new Error('Browser denied registration'))
        readTool = tool
      },
    } })
    const { result } = mount()
    act(() => result.current.setEnabled(true))
    await waitFor(() => expect(result.current.status).toMatch(/could not register: Browser denied/))
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(readTool?.execute({})).toMatchObject({ isError: true })
  })

  it('supports explicit cleanup on the older navigator API', async () => {
    const registered: WebMcpTool[] = []
    const unregisterTool = vi.fn()
    Object.defineProperty(navigator, 'modelContext', { configurable: true, value: {
      registerTool: (tool: WebMcpTool) => { registered.push(tool) }, unregisterTool,
    } })
    const { result, unmount } = mount()
    act(() => result.current.setEnabled(true))
    await waitFor(() => expect(result.current.status).toMatch(/legacy browser API/))
    expect(registered.map((tool) => tool.name)).toEqual(['typstability_read_session', 'typstability_edit_session'])
    unmount()
    expect(unregisterTool.mock.calls).toEqual([['typstability_read_session'], ['typstability_edit_session']])
    expect(registered[0].execute({})).toMatchObject({ isError: true })
  })
})
