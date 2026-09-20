import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileUp, PanelLeftClose, PanelLeftOpen, Plus, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { CanvasPage } from './components/CanvasPage'
import { PageThumbnail } from './components/PageThumbnail'
import { PreludeInspector } from './components/PreludeInspector'
import { Toolbar } from './components/Toolbar'
import { TypstInspector } from './components/TypstInspector'
import { useHistoryState } from './lib/history'
import { createPdfProxy, downloadBytes, exportPdf, readPdf } from './lib/pdf'
import { loadSession, saveSession } from './lib/storage'
import { compileTypstSvg } from './typst/client'
import { strokeTouchesPoint } from './lib/geometry'
import type {
  Box,
  EditorDocument,
  ImageElement,
  ObjectDrop,
  ObjectDragPreview,
  PageElement,
  Point,
  Selection,
  Tool,
  TypstElement,
} from './types'
import { LETTER_PAGE, uid } from './types'

const emptyDocument = (): EditorDocument => ({
  name: 'Untitled',
  prelude: '',
  originalPdf: null,
  pages: [],
  updatedAt: Date.now(),
})

function App() {
  const documentHistory = useHistoryState(emptyDocument())
  const document = documentHistory.value
  const setDocumentState = documentHistory.set
  const resetDocumentState = documentHistory.reset
  const [pdfProxy, setPdfProxy] = useState<PDFDocumentProxy | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [zoom, setZoom] = useState(0.9)
  const [penColor, setPenColor] = useState('#1f2328')
  const [penRadius, setPenRadius] = useState(2)
  const [eraserRadius, setEraserRadius] = useState(12)
  const [dragPreview, setDragPreview] = useState<ObjectDragPreview | null>(null)
  const [thumbnailsOpen, setThumbnailsOpen] = useState(true)
  const [preludeOpen, setPreludeOpen] = useState(false)
  const [preludeError, setPreludeError] = useState<string | undefined>()
  const [finalCompileRevision, setFinalCompileRevision] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [recoverable, setRecoverable] = useState<EditorDocument | null>(null)
  const [storageReady, setStorageReady] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const openInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const compileBurstStartRef = useRef<number | null>(null)
  const handledFinalCompileRef = useRef(0)

  const activePage = document.pages.find((page) => page.id === activePageId) ?? document.pages[0]
  const selectedElement = useMemo(() => {
    if (!selection) return null
    return document.pages
      .find((page) => page.id === selection.pageId)
      ?.elements.find((element) => element.id === selection.elementId) ?? null
  }, [document.pages, selection])

  const selectedTypst = selectedElement?.kind === 'typst' ? selectedElement : null
  const selectedTypstId = selectedTypst?.id
  const selectedTypstSource = selectedTypst?.source
  const selectedTypstWidth = selectedTypst?.width
  const selectedTypstHeight = selectedTypst?.height
  const selectedPageId = selection?.pageId

  useEffect(() => {
    loadSession()
      .then((session) => setRecoverable(session ?? null))
      .catch(() => undefined)
      .finally(() => setStorageReady(true))
  }, [])

  useEffect(() => {
    if (!storageReady || !document.pages.length) return
    const timer = window.setTimeout(() => {
      void saveSession({ ...document, updatedAt: Date.now() })
    }, 800)
    return () => window.clearTimeout(timer)
  }, [document, storageReady])

  useEffect(() => {
    if (!document.originalPdf) {
      setPdfProxy(null)
      return
    }
    let cancelled = false
    createPdfProxy(document.originalPdf).then((proxy) => {
      if (!cancelled) setPdfProxy(proxy)
    }).catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
    return () => { cancelled = true }
  }, [document.originalPdf])

  const updateDocument = useCallback((updater: (current: EditorDocument) => EditorDocument, record = true) => {
    setDocumentState((current) => ({ ...updater(current), updatedAt: Date.now() }), record)
  }, [setDocumentState])

  const updateElement = useCallback((pageId: string, next: PageElement, record = true) => {
    updateDocument((current) => ({
      ...current,
      pages: current.pages.map((page) => page.id === pageId
        ? { ...page, elements: page.elements.map((element) => element.id === next.id ? next : element) }
        : page),
    }), record)
  }, [updateDocument])

  useEffect(() => {
    if (!selectedTypstId || selectedTypstSource === undefined || selectedTypstWidth === undefined || selectedTypstHeight === undefined || !selectedPageId) return
    const id = selectedTypstId
    const pageId = selectedPageId
    const source = selectedTypstSource
    const width = selectedTypstWidth
    const height = selectedTypstHeight
    const prelude = document.prelude
    const forceFinal = handledFinalCompileRef.current !== finalCompileRevision
    handledFinalCompileRef.current = finalCompileRevision
    const now = performance.now()
    if (forceFinal) compileBurstStartRef.current = null
    else if (compileBurstStartRef.current === null) compileBurstStartRef.current = now
    const elapsed = compileBurstStartRef.current === null ? 0 : now - compileBurstStartRef.current
    const delay = forceFinal ? 0 : Math.max(0, Math.min(40, 80 - elapsed))
    const timer = window.setTimeout(() => {
      compileBurstStartRef.current = null
      compileTypstSvg(source, width, height, prelude)
        .then((previewSvg) => {
          updateDocument((current) => ({
            ...current,
            pages: current.pages.map((page) => page.id === pageId
              ? {
                  ...page,
                  elements: page.elements.map((element) =>
                    element.id === id && element.kind === 'typst'
                    && element.source === source && element.width === width && element.height === height
                      ? {
                          ...element,
                          previewSvg,
                          previewWidth: width,
                          previewHeight: height,
                          previewPrelude: prelude,
                          error: undefined,
                        }
                      : element),
                }
              : page),
          }), false)
        })
        .catch((error) => {
          updateDocument((current) => ({
            ...current,
            pages: current.pages.map((page) => page.id === pageId
              ? {
                  ...page,
                  elements: page.elements.map((element) =>
                    element.id === id && element.kind === 'typst'
                    && element.source === source && element.width === width && element.height === height
                      ? { ...element, error: error instanceof Error ? error.message : String(error) }
                      : element),
                }
              : page),
          }), false)
        })
    }, delay)
    return () => window.clearTimeout(timer)
  }, [
    selectedTypstSource,
    selectedTypstWidth,
    selectedTypstHeight,
    selectedTypstId,
    selectedPageId,
    document.prelude,
    finalCompileRevision,
    updateDocument,
  ])

  useEffect(() => {
    if (!preludeOpen) return
    const prelude = document.prelude
    const timer = window.setTimeout(() => {
      compileTypstSvg('', 240, 120, prelude)
        .then(() => setPreludeError(undefined))
        .catch((error) => setPreludeError(error instanceof Error ? error.message : String(error)))
    }, 80)
    return () => window.clearTimeout(timer)
  }, [document.prelude, preludeOpen])

  const loadDocument = useCallback((next: EditorDocument) => {
    resetDocumentState(next)
    setSelection(null)
    setActivePageId(next.pages[0]?.id ?? null)
    setTool('select')
    setPreludeOpen(false)
    setNotice(null)
  }, [resetDocumentState])

  const openPdf = async (file?: File) => {
    if (!file) return
    try {
      loadDocument(await readPdf(file))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That PDF could not be opened.')
    }
  }

  const newDocument = () => {
    const pageId = uid()
    loadDocument({
      name: 'Untitled',
      prelude: '',
      originalPdf: null,
      pages: [{ id: pageId, sourceIndex: null, ...LETTER_PAGE, elements: [] }],
      updatedAt: Date.now(),
    })
  }

  const insertBlankPage = () => {
    const pageId = uid()
    const dimensions = activePage ?? LETTER_PAGE
    updateDocument((current) => {
      const at = Math.max(0, current.pages.findIndex((page) => page.id === activePage?.id) + 1)
      const pages = [...current.pages]
      pages.splice(at, 0, {
        id: pageId,
        sourceIndex: null,
        width: dimensions.width,
        height: dimensions.height,
        elements: [],
      })
      return { ...current, pages }
    })
    setActivePageId(pageId)
    setSelection(null)
  }

  const deletePage = (pageId: string) => {
    if (document.pages.length === 1) return
    const index = document.pages.findIndex((page) => page.id === pageId)
    updateDocument((current) => ({ ...current, pages: current.pages.filter((page) => page.id !== pageId) }))
    const next = document.pages[index + 1] ?? document.pages[index - 1]
    setActivePageId(next?.id ?? null)
    if (selection?.pageId === pageId) setSelection(null)
  }

  const createTypst = (pageId: string, box: Box) => {
    const element: TypstElement = {
      id: uid(),
      kind: 'typst',
      ...box,
      source: '',
    }
    updateDocument((current) => ({
      ...current,
      pages: current.pages.map((page) => page.id === pageId
        ? { ...page, elements: [...page.elements, element] }
        : page),
    }))
    setSelection({ pageId, elementId: element.id })
    setPreludeOpen(false)
    setTool('select')
  }

  const dropElement = useCallback((sourcePageId: string, element: ImageElement | TypstElement, drop: ObjectDrop) => {
    const sourcePage = document.pages.find((page) => page.id === sourcePageId)
    if (!sourcePage) return

    let destinationPageId = sourcePageId
    let destinationShell: HTMLElement | null = null
    if (element.kind === 'typst') {
      for (const shell of globalThis.document.querySelectorAll<HTMLElement>('[data-page-id]')) {
        const rect = shell.getBoundingClientRect()
        if (drop.clientX >= rect.left && drop.clientX <= rect.right
          && drop.clientY >= rect.top && drop.clientY <= rect.bottom) {
          destinationPageId = shell.dataset.pageId || sourcePageId
          destinationShell = shell
          break
        }
      }
    }

    const destinationPage = document.pages.find((page) => page.id === destinationPageId) ?? sourcePage
    let x = element.x
    let y = element.y
    if (destinationPageId !== sourcePageId && destinationShell) {
      const rect = destinationShell.getBoundingClientRect()
      x = (drop.clientX - rect.left) / zoom - drop.grabOffset.x
      y = (drop.clientY - rect.top) / zoom - drop.grabOffset.y
    }
    const moved = {
      ...element,
      x: Math.max(0, Math.min(destinationPage.width - element.width, x)),
      y: Math.max(0, Math.min(destinationPage.height - element.height, y)),
    }

    updateDocument((current) => ({
      ...current,
      pages: current.pages.map((page) => {
        if (page.id === sourcePageId && page.id === destinationPageId) {
          return { ...page, elements: page.elements.map((candidate) => candidate.id === moved.id ? moved : candidate) }
        }
        if (page.id === sourcePageId) {
          return { ...page, elements: page.elements.filter((candidate) => candidate.id !== moved.id) }
        }
        if (page.id === destinationPageId) {
          return { ...page, elements: [...page.elements, moved] }
        }
        return page
      }),
    }))
    setActivePageId(destinationPageId)
    setSelection({ pageId: destinationPageId, elementId: moved.id })
  }, [document.pages, updateDocument, zoom])

  const eraseAt = useCallback((pageId: string, point: Point) => {
    const page = document.pages.find((candidate) => candidate.id === pageId)
    const erasedIds = new Set(page?.elements
      .filter((element) => element.kind === 'stroke' && strokeTouchesPoint(element, point, eraserRadius))
      .map((element) => element.id) ?? [])
    if (!erasedIds.size) return
    updateDocument((current) => ({
      ...current,
      pages: current.pages.map((candidate) => candidate.id === pageId
        ? { ...candidate, elements: candidate.elements.filter((element) => !erasedIds.has(element.id)) }
        : candidate),
    }))
  }, [document.pages, eraserRadius, updateDocument])

  const addImage = async (file?: File) => {
    if (!file || !activePage) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setNotice('Please choose a PNG or JPEG image.')
      return
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image()
      next.onload = () => resolve(next)
      next.onerror = reject
      next.src = dataUrl
    })
    const maxWidth = Math.min(320, activePage.width - 72)
    const width = Math.min(maxWidth, image.naturalWidth)
    const height = width * image.naturalHeight / image.naturalWidth
    const element: PageElement = {
      id: uid(),
      kind: 'image',
      x: (activePage.width - width) / 2,
      y: 72,
      width,
      height,
      dataUrl,
      mime: file.type as 'image/png' | 'image/jpeg',
    }
    updateDocument((current) => ({
      ...current,
      pages: current.pages.map((page) => page.id === activePage.id
        ? { ...page, elements: [...page.elements, element] }
        : page),
    }))
    setSelection({ pageId: activePage.id, elementId: element.id })
    setTool('select')
  }

  const deleteSelection = useCallback(() => {
    if (!selection) return
    updateDocument((current) => ({
      ...current,
      pages: current.pages.map((page) => page.id === selection.pageId
        ? { ...page, elements: page.elements.filter((element) => element.id !== selection.elementId) }
        : page),
    }))
    setSelection(null)
  }, [selection, updateDocument])

  const doExport = async () => {
    if (!document.pages.length) return
    setExporting(true)
    setNotice(null)
    try {
      const bytes = await exportPdf(document)
      downloadBytes(bytes, `${document.name || 'document'}-edited.pdf`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Export failed.')
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const editing = target.matches('textarea, input')
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) documentHistory.redo()
        else documentHistory.undo()
      }
      if (!editing && (event.key === 'Backspace' || event.key === 'Delete')) {
        event.preventDefault()
        deleteSelection()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        openInputRef.current?.click()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        void doExport()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const setChosenTool = (next: Tool) => {
    setTool(next)
    if (next !== 'select') {
      setSelection(null)
      setPreludeOpen(false)
    }
  }

  if (!storageReady) {
    return <main className="loading-screen"><RotateCcw className="spin" size={18} /> Loading locally…</main>
  }

  if (!document.pages.length) {
    return (
      <main className="welcome">
        <div className="welcome-card">
          <div className="welcome-mark">T</div>
          <p className="eyebrow">LOCAL PDF EDITOR</p>
          <h1>Quiet tools for working on PDFs.</h1>
          <p className="welcome-copy">Add images, freehand notes, blank pages, and beautifully typeset Typst—without sending your document anywhere.</p>
          <div className="welcome-actions">
            <button className="primary-large" onClick={() => openInputRef.current?.click()}><FileUp size={18} /> Open a PDF</button>
            <button className="secondary-large" onClick={newDocument}><Plus size={18} /> Blank document</button>
          </div>
          {recoverable && recoverable.pages.length > 0 && (
            <button className="restore-button" onClick={() => loadDocument(recoverable)}>
              <RotateCcw size={15} /> Restore “{recoverable.name}”
              <span>{new Date(recoverable.updatedAt).toLocaleString()}</span>
            </button>
          )}
          <div className="privacy-note"><ShieldCheck size={15} /> Your files stay in this browser.</div>
        </div>
        <input ref={openInputRef} hidden type="file" accept="application/pdf" onChange={(event) => void openPdf(event.target.files?.[0])} />
      </main>
    )
  }

  return (
    <div className="app-shell">
      <Toolbar
        name={document.name}
        tool={tool}
        zoom={zoom}
        canUndo={documentHistory.canUndo}
        canRedo={documentHistory.canRedo}
        exporting={exporting}
        penColor={penColor}
        penRadius={penRadius}
        eraserRadius={eraserRadius}
        preludeOpen={preludeOpen}
        onOpen={() => openInputRef.current?.click()}
        onNew={newDocument}
        onImage={() => imageInputRef.current?.click()}
        onTool={setChosenTool}
        onBlankPage={insertBlankPage}
        onUndo={documentHistory.undo}
        onRedo={documentHistory.redo}
        onZoom={(next) => setZoom(Math.min(1.8, Math.max(0.4, next)))}
        onExport={() => void doExport()}
        onPenColor={setPenColor}
        onPenRadius={setPenRadius}
        onEraserRadius={setEraserRadius}
        onPrelude={() => setPreludeOpen((open) => !open)}
      />
      <div className="workspace">
        <nav className={`page-rail ${thumbnailsOpen ? '' : 'is-collapsed'}`} aria-label="Pages">
          <button
            className="rail-toggle"
            onClick={() => setThumbnailsOpen((open) => !open)}
            title={thumbnailsOpen ? 'Hide page thumbnails' : 'Show page thumbnails'}
            aria-label={thumbnailsOpen ? 'Hide page thumbnails' : 'Show page thumbnails'}
          >
            {thumbnailsOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          </button>
          {thumbnailsOpen && document.pages.map((page, index) => (
            <button
              key={page.id}
              className={`page-thumbnail ${activePage?.id === page.id ? 'is-active' : ''}`}
              onClick={() => {
                setActivePageId(page.id)
                globalThis.document.getElementById(`page-${page.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}
            >
              <PageThumbnail page={page} pdf={pdfProxy} />
              <span className="thumbnail-number">{index + 1}</span>
              {document.pages.length > 1 && (
                <i
                  role="button"
                  aria-label={`Delete page ${index + 1}`}
                  onClick={(event) => { event.stopPropagation(); deletePage(page.id) }}
                ><Trash2 size={12} /></i>
              )}
            </button>
          ))}
        </nav>
        <main className={`document-scroll ${selectedTypst || preludeOpen ? 'with-inspector' : ''}`}>
          {document.pages.map((page, index) => (
            <div id={`page-${page.id}`} key={page.id} className="page-positioner">
              <CanvasPage
                page={page}
                pageNumber={index + 1}
                pdf={pdfProxy}
                zoom={zoom}
                tool={tool}
                selection={selection}
                penColor={penColor}
                penRadius={penRadius}
                eraserRadius={eraserRadius}
                onActivate={() => setActivePageId(page.id)}
                onSelect={(elementId) => {
                  setPreludeOpen(false)
                  setSelection(elementId ? { pageId: page.id, elementId } : null)
                }}
                onChangeElement={(element, record) => updateElement(page.id, element, record)}
                onResizeEnd={(element) => {
                  if (element.kind === 'typst') setFinalCompileRevision((revision) => revision + 1)
                }}
                onDropElement={(element, drop) => dropElement(page.id, element, drop)}
                onDragPreview={setDragPreview}
                onAddStroke={(points) => {
                  if (!points.length) return
                  updateDocument((current) => ({
                    ...current,
                    pages: current.pages.map((candidate) => candidate.id === page.id
                      ? {
                          ...candidate,
                          elements: [...candidate.elements, {
                            id: uid(), kind: 'stroke', points, color: penColor, radius: penRadius,
                          }],
                        }
                      : candidate),
                  }))
                }}
                onEraseAt={(point) => eraseAt(page.id, point)}
                onCreateTypst={(box) => createTypst(page.id, box)}
              />
            </div>
          ))}
        </main>
        {!preludeOpen && selectedTypst && selection && (
          <TypstInspector
            element={selectedTypst}
            onSourceChange={(source) => updateElement(selection.pageId, { ...selectedTypst, source })}
            onDelete={deleteSelection}
            onClose={() => setSelection(null)}
          />
        )}
        {preludeOpen && (
          <PreludeInspector
            source={document.prelude}
            error={preludeError}
            onChange={(prelude) => updateDocument((current) => ({ ...current, prelude }))}
            onClose={() => setPreludeOpen(false)}
          />
        )}
        {dragPreview && (
          <div
            className="object-drag-preview"
            style={{
              left: dragPreview.clientX - dragPreview.grabOffset.x * zoom,
              top: dragPreview.clientY - dragPreview.grabOffset.y * zoom,
              width: dragPreview.element.width * zoom,
              height: dragPreview.element.height * zoom,
            }}
          >
            {dragPreview.element.kind === 'image' && (
              <img src={dragPreview.element.dataUrl} alt="" />
            )}
            {dragPreview.element.kind === 'typst' && dragPreview.element.previewSvg && (
              <img
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(dragPreview.element.previewSvg)}`}
                alt=""
              />
            )}
          </div>
        )}
      </div>
      {notice && <div className="notice" role="alert">{notice}<button onClick={() => setNotice(null)}>×</button></div>}
      <input ref={openInputRef} hidden type="file" accept="application/pdf" onChange={(event) => void openPdf(event.target.files?.[0])} />
      <input ref={imageInputRef} hidden type="file" accept="image/png,image/jpeg" onChange={(event) => void addImage(event.target.files?.[0])} />
    </div>
  )
}

export default App
