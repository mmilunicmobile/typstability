import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Project } from './lib/storage'
import type { Box, EditorPage } from './types'
import { compileTypstSvg } from './typst/client'

vi.mock('./components/CanvasPage', () => ({
  CanvasPage: ({ page, onCreateTypst }: { page: EditorPage; onCreateTypst: (box: Box) => void }) => <section className="page-shell" data-page-id={page.id}
    data-elements={JSON.stringify(page.elements.map((element) => ({
      kind: element.kind, x: 'x' in element ? element.x : undefined, y: 'y' in element ? element.y : undefined,
    })))}><button onClick={() => onCreateTypst({ x: 10, y: 10, width: 120, height: 50 })}>Add test Typst box</button></section>,
}))

vi.mock('./lib/images', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/images')>(),
  decodeImageFile: async () => ({ dataUrl: 'data:image/png;base64,AA==', mime: 'image/png' as const, naturalWidth: 100, naturalHeight: 80 }),
}))

const records = vi.hoisted(() => new Map<string, Project>())
vi.mock('./lib/storage', () => ({
  listProjects: vi.fn(async () => [...records.values()].map((project) => ({
    id: project.id, name: project.document.name, createdAt: project.createdAt,
    updatedAt: project.document.updatedAt, pageCount: project.document.pages.length,
  }))),
  loadProject: vi.fn(async (id: string) => structuredClone(records.get(id))),
  saveProject: vi.fn(async (project: Project) => { records.set(project.id, structuredClone(project)); return project.id }),
  deleteProject: vi.fn(async (id: string) => { records.delete(id) }),
}))

vi.mock('./typst/client', () => ({
  compileTypstSvg: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg" />'),
  compileTypstPdf: async () => new Uint8Array(),
}))

beforeEach(() => {
  records.clear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Element.prototype.scrollIntoView = vi.fn()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true, value() { this.open = true },
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

async function createBlankProject(name = 'Test document') {
  const start = await screen.findByRole('button', { name: /Start a blank document/ })
  await waitFor(() => expect(start).toBeEnabled())
  fireEvent.click(start)
  fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Create document' }))
  await screen.findByRole('button', { name: 'Back to projects' })
}

function insertBlankPage() {
  fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /Blank page/ }))
}

describe('page controls', () => {
  it('adds pages without replacing the document and keeps the previous project', async () => {
    const { container } = render(<App />)
    await createBlankProject('First')
    expect(container.querySelectorAll('.page-shell')).toHaveLength(1)

    insertBlankPage()
    expect(container.querySelectorAll('.page-shell')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }))
    await screen.findByRole('button', { name: /Start a blank document/ })
    await createBlankProject('Second')
    await waitFor(() => expect(container.querySelectorAll('.page-shell')).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }))
    fireEvent.click(await screen.findByRole('button', { name: /First.*2 pages/ }))
    await waitFor(() => expect(container.querySelectorAll('.page-shell')).toHaveLength(2))
  })

  it('moves a thumbnail to the chosen position and can undo the move', async () => {
    const { container } = render(<App />)
    await createBlankProject()
    insertBlankPage()
    insertBlankPage()

    const order = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.page-thumbnail'))
      .map((button) => button.dataset.pageId)
    const before = order()
    const [first, , third] = Array.from(container.querySelectorAll<HTMLButtonElement>('.page-thumbnail'))
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() }
    fireEvent.dragStart(first, { dataTransfer })
    fireEvent.dragOver(third, { dataTransfer, clientY: 100 })
    expect(third).toHaveClass('drop-after')
    fireEvent.drop(third, { dataTransfer, clientY: 100 })

    expect(order()).toEqual([before[1], before[2], before[0]])
    expect(Array.from(container.querySelectorAll<HTMLElement>('.page-shell')).map((page) => page.dataset.pageId))
      .toEqual([before[1], before[2], before[0]])
    fireEvent.click(screen.getByTitle('Undo'))
    expect(order()).toEqual(before)
  })
})

describe('image insertion', () => {
  it('pastes into the active page and drops at a position on another page', async () => {
    const { container } = render(<App />)
    await createBlankProject()
    insertBlankPage()
    const [first, second] = Array.from(container.querySelectorAll<HTMLElement>('.page-shell'))
    const file = new File(['image'], 'photo.png', { type: 'image/png' })

    fireEvent.paste(window, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } })
    await waitFor(() => expect(JSON.parse(second.dataset.elements ?? '[]')).toHaveLength(1))

    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 30 } as DOMRect)
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: '' }
    fireEvent.dragOver(first, { dataTransfer, clientX: 110, clientY: 120 })
    expect(first.parentElement).toHaveClass('is-image-drop-target')
    const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 110, clientY: 120 })
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer })
    fireEvent(first, drop)
    await waitFor(() => expect(JSON.parse(first.dataset.elements ?? '[]')).toHaveLength(1))
    expect(JSON.parse(first.dataset.elements ?? '[]')[0]).toMatchObject({ kind: 'image', x: 50, y: 60 })
    expect(JSON.parse(second.dataset.elements ?? '[]')).toHaveLength(1)
  })

  it('creates a saved project when an image is pasted in the project library', async () => {
    const { container } = render(<App />)
    await screen.findByRole('button', { name: /Start a blank document/ })
    const file = new File(['image'], 'photo.png', { type: 'image/png' })
    fireEvent.paste(window, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } })
    await waitFor(() => expect(container.querySelectorAll('.page-shell')).toHaveLength(1))
    expect(JSON.parse(container.querySelector<HTMLElement>('.page-shell')?.dataset.elements ?? '[]')).toHaveLength(1)
  })
})

describe('zoom controls', () => {
  it('reaches 500% without exceeding it', async () => {
    render(<App />)
    await createBlankProject()
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' })
    for (let index = 0; index < 50; index += 1) fireEvent.click(zoomIn)
    expect(screen.getByText('500%')).toBeInTheDocument()
    fireEvent.click(zoomIn)
    expect(screen.getByText('500%')).toBeInTheDocument()
  })
})

describe('Typst top inset', () => {
  it('can be changed for a selected box and triggers a new preview', async () => {
    render(<App />)
    await createBlankProject()
    fireEvent.click(screen.getByRole('button', { name: 'Add test Typst box' }))
    expect(screen.getByRole('textbox', { name: 'Text & Typst source' })).toHaveFocus()
    const inset = screen.getByRole('spinbutton', { name: 'Top inset' })
    expect(inset).toHaveValue(4)
    fireEvent.change(inset, { target: { value: '12' } })
    expect(inset).toHaveValue(12)
    await waitFor(() => expect(compileTypstSvg).toHaveBeenCalledWith('', 120, 50, '', 12, ''))
    fireEvent.change(screen.getByLabelText('Fill (Typst)'), { target: { value: 'rgb("#f5f0e6")' } })
    await waitFor(() => expect(compileTypstSvg).toHaveBeenCalledWith('', 120, 50, '', 12, 'rgb("#f5f0e6")'))
  })
})

// Use the real app state/history/autosave path while supplying the browser capability.
describe('WebMCP agent access', () => {
  it('registers real tools, commits undoable autosaved edits, rejects stale batches, and revokes access', async () => {
    const tools = new Map<string, import('./lib/use-webmcp').WebMcpTool>()
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      registerTool: vi.fn((tool: import('./lib/use-webmcp').WebMcpTool, options: { signal: AbortSignal }) => {
        tools.set(tool.name, tool)
        options.signal.addEventListener('abort', () => { if (tools.get(tool.name) === tool) tools.delete(tool.name) })
      }),
    } })
    try {
      render(<App />)
      await createBlankProject()
      expect(tools.size).toBe(0)
      fireEvent.click(screen.getByText('Agent access'))
      fireEvent.click(screen.getByRole('checkbox', { name: /Allow agents/ }))
      await waitFor(() => expect(tools.size).toBe(2))
      const readTool = tools.get('typstability_read_session')!
      const editTool = tools.get('typstability_edit_session')!
      const read = () => JSON.parse((readTool.execute({}) as { content: { text: string }[] }).content[0].text)
      const before = read()
      let editResult: any
      act(() => { editResult = editTool.execute({ revision: before.revision, operations: [
        { action: 'set_document', name: 'Agent edited', prelude: '#set text(size: 12pt)' },
        { action: 'add_text_box', pageId: before.document.pages[0].id, x: 25, y: 30, width: 200, height: 70, source: 'From the agent' },
      ] }) })
      expect(editResult.isError).not.toBe(true)
      const after = read()
      expect(after.document).toMatchObject({ name: 'Agent edited', prelude: '#set text(size: 12pt)', pages: [{ elements: [{ source: 'From the agent', width: 200 }] }] })
      expect(after.revision).toBeGreaterThan(before.revision)
      const returned = JSON.parse(editResult.content[0].text)
      expect(returned.revision).toBe(after.revision)
      expect(editTool.execute({ revision: before.revision, operations: [{ action: 'set_document', name: 'Stale' }] })).toMatchObject({ isError: true })
      await waitFor(() => expect([...records.values()][0].document.name).toBe('Agent edited'))
      expect([...records.values()][0].document.pages[0].elements[0]).toMatchObject({ source: 'From the agent' })
      fireEvent.click(screen.getByTitle('Undo'))
      expect(read().document).toMatchObject({ name: 'Test document', prelude: '', pages: [{ elements: [] }] })
      fireEvent.click(screen.getByTitle('Redo'))
      expect(read().document.name).toBe('Agent edited')
      fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }))
      await waitFor(() => expect(tools.size).toBe(0))
      expect(editTool.execute({ revision: read().revision, operations: [{ action: 'set_document', name: 'Revoked' }] })).toMatchObject({ isError: true })
    } finally { delete (document as Document & { modelContext?: unknown }).modelContext }
  })

  it('explains browser support when WebMCP is unavailable', async () => {
    render(<App />)
    await createBlankProject()
    fireEvent.click(screen.getByText('Agent access'))
    fireEvent.click(screen.getByRole('checkbox', { name: /Allow agents/ }))
    expect(await screen.findByText(/WebMCP is unavailable in this browser/)).toBeInTheDocument()
  })
})
