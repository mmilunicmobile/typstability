import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PanelLeftClose, PanelLeftOpen, Plus, RotateCcw, Trash2, ZoomIn, ZoomOut } from 'lucide-react'
import type { DragEvent as ReactDragEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { CanvasPage } from './components/CanvasPage'
import { PageThumbnail } from './components/PageThumbnail'
import { PreludeInspector } from './components/PreludeInspector'
import { Toolbar } from './components/Toolbar'
import { TypstInspector } from './components/TypstInspector'
import { ImageInspector } from './components/ImageInspector'
import type { EditorSessions } from './components/TypstCodeEditor'
import { useAlignmentSettings } from './lib/use-alignment-settings'
import { snapBoxPosition } from './lib/alignment'
import { useViewportZoom } from './lib/use-viewport-zoom'
import { useTrackpadZoom } from './lib/use-trackpad-zoom'
import { useWebMcp } from './lib/use-webmcp'
import { AgentAccess } from './components/AgentAccess'
import { useHistoryState } from './lib/history'
import { decodeImageFile, isSupportedImageFile, placeImage } from './lib/images'
import { imageCropStyle } from './lib/image-crop'
import { createPdfProxy, downloadBytes, exportPdf, readPdf } from './lib/pdf'
import { useProjects } from './lib/use-projects'
import { downloadProject, parseProject } from './lib/project-file'
import { ProjectLibrary } from './components/ProjectLibrary'
import { compileTypstSvg } from './typst/client'
import { DEFAULT_TYPST_TOP_INSET } from './typst/source'
import { strokeTouchesPoint } from './lib/geometry'
import { reorderPages } from './lib/pages'
import { nudgeElement } from './lib/nudge'
import type { DropSide } from './lib/pages'
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

function thumbnailDropSide(event: ReactDragEvent<HTMLElement>): DropSide {
  const bounds = event.currentTarget.getBoundingClientRect()
  return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
}

function App() {
  const documentHistory = useHistoryState(emptyDocument())
  const document = documentHistory.value
  const setDocumentState = documentHistory.set
  const resetDocumentState = documentHistory.reset
  const [pdfProxy, setPdfProxy] = useState<PDFDocumentProxy | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [sourceFocusRequest, setSourceFocusRequest] = useState(0)
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const alignment = useAlignmentSettings()
  const [penColor, setPenColor] = useState('#1f2328')
  const [penRadius, setPenRadius] = useState(2)
  const [eraserRadius, setEraserRadius] = useState(12)
  const [dragPreview, setDragPreview] = useState<ObjectDragPreview | null>(null)
  const [thumbnailsOpen, setThumbnailsOpen] = useState(true)
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null)
  const [pageDropTarget, setPageDropTarget] = useState<{ pageId: string; side: DropSide } | null>(null)
  const [imageDropTarget, setImageDropTarget] = useState<string | null>(null)
  const [preludeOpen, setPreludeOpen] = useState(false)
  const [preludeError, setPreludeError] = useState<string | undefined>()
  const [finalCompileRevision, setFinalCompileRevision] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const openInputRef = useRef<HTMLInputElement>(null)
  const documentScrollRef = useRef<HTMLElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const [readingFile, setReadingFile] = useState(false)
  const [editorSessions] = useState<EditorSessions>(() => new Map())
  const generation = useRef(0)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const compileBurstStartRef = useRef<number | null>(null)
  const handledFinalCompileRef = useRef(0)
  const backgroundPreviewRequests = useRef(new Map<string, string>())
  const draggingPageIdRef = useRef<string | null>(null)
  const documentEpochRef = useRef(0)

  const loadDocument = useCallback((next: EditorDocument) => {
    generation.current += 1
    documentEpochRef.current += 1
    backgroundPreviewRequests.current.clear()
    draggingPageIdRef.current = null
    setDraggingPageId(null)
    setPageDropTarget(null)
    setImageDropTarget(null)
    setDragPreview(null)
    setPreludeError(undefined)
    resetDocumentState(next)
    setSelection(null)
    setActivePageId(next.pages[0]?.id ?? null)
    setTool('select')
    setPreludeOpen(false)
    setNotice(null)
  }, [resetDocumentState])

  const library = useProjects(document, loadDocument)
  const busy = library.busy || readingFile
  const widestPage = Math.max(0, ...document.pages.map((page) => page.width))
  const [zoom, setZoom] = useViewportZoom(documentScrollRef, widestPage, !library.libraryOpen && document.pages.length > 0)
  useTrackpadZoom(documentScrollRef, zoom, setZoom, !library.libraryOpen && document.pages.length > 0)

  const activePage = document.pages.find((page) => page.id === activePageId) ?? document.pages[0]
  const selectedElement = useMemo(() => {
    if (!selection) return null
    return document.pages
      .find((page) => page.id === selection.pageId)
      ?.elements.find((element) => element.id === selection.elementId) ?? null
  }, [document.pages, selection])

  const selectedTypst = selectedElement?.kind === 'typst' ? selectedElement : null
  const selectedImage = selectedElement?.kind === 'image' ? selectedElement : null
  const selectedTypstId = selectedTypst?.id
  const selectedTypstSource = selectedTypst?.source
  const selectedTypstWidth = selectedTypst?.width
  const selectedTypstHeight = selectedTypst?.height
  const selectedTypstTopInset = selectedTypst?.topInset ?? DEFAULT_TYPST_TOP_INSET
  const selectedTypstPageFill = selectedTypst?.pageFill ?? ''
  const selectedPageId = selection?.pageId

  useEffect(() => {
    if (!document.originalPdf) {
      setPdfProxy(null)
      return
    }
    let cancelled = false
    setPdfProxy(null)
    let loaded: PDFDocumentProxy | null = null
    createPdfProxy(document.originalPdf).then((proxy) => {
      if (cancelled) { void proxy.loadingTask.destroy(); return }
      loaded = proxy
      setPdfProxy(proxy)
    }).catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
    return () => { cancelled = true; void loaded?.loadingTask.destroy() }
  }, [document.originalPdf])

  const updateDocument = useCallback((updater: (current: EditorDocument) => EditorDocument, record = true) => {
    setDocumentState((current) => ({ ...updater(current), updatedAt: Date.now() }), record)
  }, [setDocumentState])

  const agentAccess = useWebMcp({
    active: library.ready && !library.libraryOpen && !busy && document.pages.length > 0,
    document, projectId: library.activeId ?? null, selection,
    onEdit: (next) => updateDocument(() => next),
  })

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
    let cancelled = false
    const revision = generation.current
    const id = selectedTypstId
    const pageId = selectedPageId
    const source = selectedTypstSource
    const width = selectedTypstWidth
    const height = selectedTypstHeight
    const topInset = selectedTypstTopInset
    const pageFill = selectedTypstPageFill
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
      compileTypstSvg(source, width, height, prelude, topInset, pageFill)
        .then((previewSvg) => {
          if (cancelled || revision !== generation.current) return
          updateDocument((current) => ({
            ...current,
            pages: current.pages.map((page) => page.id === pageId
              ? {
                  ...page,
                  elements: page.elements.map((element) =>
                    element.id === id && element.kind === 'typst'
                    && current.prelude === prelude && element.source === source && element.width === width && element.height === height
                    && (element.topInset ?? DEFAULT_TYPST_TOP_INSET) === topInset
                    && (element.pageFill ?? '') === pageFill
                      ? {
                          ...element,
                          previewSvg,
                          previewSource: source,
                          previewWidth: width,
                          previewHeight: height,
                          previewPrelude: prelude,
                          previewTopInset: topInset,
                          previewPageFill: pageFill,
                          error: undefined,
                        }
                      : element),
                }
              : page),
          }), false)
        })
        .catch((error) => {
          if (cancelled || revision !== generation.current) return
          updateDocument((current) => ({
            ...current,
            pages: current.pages.map((page) => page.id === pageId
              ? {
                  ...page,
                  elements: page.elements.map((element) =>
                    element.id === id && element.kind === 'typst'
                    && current.prelude === prelude && element.source === source && element.width === width && element.height === height
                    && (element.topInset ?? DEFAULT_TYPST_TOP_INSET) === topInset
                    && (element.pageFill ?? '') === pageFill
                      ? { ...element, error: error instanceof Error ? error.message : String(error) }
                      : element),
                }
              : page),
          }), false)
        })
    }, delay)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [
    selectedTypstSource,
    selectedTypstWidth,
    selectedTypstHeight,
    selectedTypstTopInset,
    selectedTypstPageFill,
    selectedTypstId,
    selectedPageId,
    document.prelude,
    finalCompileRevision,
    updateDocument,
  ])

  useEffect(() => {
    const prelude = document.prelude
    for (const page of document.pages) {
      for (const element of page.elements) {
        if (element.kind !== 'typst' || (page.id === selectedPageId && element.id === selectedTypstId)) continue
        if (element.previewSvg && element.previewSource === element.source
          && element.previewWidth === element.width && element.previewHeight === element.height
          && element.previewPrelude === prelude
          && element.previewTopInset === (element.topInset ?? DEFAULT_TYPST_TOP_INSET)
          && element.previewPageFill === (element.pageFill ?? '')) continue
        const topInset = element.topInset ?? DEFAULT_TYPST_TOP_INSET
        const pageFill = element.pageFill ?? ''
        const key = JSON.stringify([element.source, element.width, element.height, prelude, topInset, pageFill])
        if (backgroundPreviewRequests.current.get(element.id) === key) continue
        backgroundPreviewRequests.current.set(element.id, key)
        const { id, source, width, height } = element
        const pageId = page.id
        compileTypstSvg(source, width, height, prelude, topInset, pageFill)
          .then((previewSvg) => {
            if (backgroundPreviewRequests.current.get(id) === key) backgroundPreviewRequests.current.delete(id)
            updateDocument((current) => ({
              ...current,
              pages: current.pages.map((candidate) => candidate.id === pageId ? {
                ...candidate,
                elements: candidate.elements.map((item) => item.kind === 'typst' && item.id === id
                  && item.source === source && item.width === width && item.height === height
                  && current.prelude === prelude
                  && (item.topInset ?? DEFAULT_TYPST_TOP_INSET) === topInset
                  && (item.pageFill ?? '') === pageFill
                  ? { ...item, previewSvg, previewSource: source, previewWidth: width,
                    previewHeight: height, previewPrelude: prelude, previewTopInset: topInset,
                    previewPageFill: pageFill, error: undefined }
                  : item),
              } : candidate),
            }), false)
          })
          .catch((error) => updateDocument((current) => ({
            ...current,
            pages: current.pages.map((candidate) => candidate.id === pageId ? {
              ...candidate,
              elements: candidate.elements.map((item) => item.kind === 'typst' && item.id === id
                && item.source === source && item.width === width && item.height === height
                && current.prelude === prelude
                && (item.topInset ?? DEFAULT_TYPST_TOP_INSET) === topInset
                && (item.pageFill ?? '') === pageFill
                ? { ...item, error: error instanceof Error ? error.message : String(error) }
                : item),
            } : candidate),
          }), false))
      }
    }
  }, [document.pages, document.prelude, selectedPageId, selectedTypstId, updateDocument])

  useEffect(() => {
    if (!preludeOpen) return
    setPreludeError(undefined)
    let cancelled = false
    const prelude = document.prelude
    const timer = window.setTimeout(() => {
      compileTypstSvg('', 240, 120, prelude)
        .then(() => { if (!cancelled) setPreludeError(undefined) })
        .catch((error) => { if (!cancelled) setPreludeError(error instanceof Error ? error.message : String(error)) })
    }, 80)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [document.prelude, preludeOpen])

  const openPdf = async (file?: File) => {
    if (!file) return
    setReadingFile(true)
    try {
      await library.create(await readPdf(file))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That PDF could not be opened.')
    } finally { setReadingFile(false) }
  }

  const importProject = async (file?: File) => {
    if (!file) return
    setReadingFile(true)
    try {
      const next = parseProject(await file.text())
      if (next.originalPdf) {
        const pdf = await createPdfProxy(next.originalPdf)
        try {
          if (next.pages.some((page) => page.sourceIndex !== null && page.sourceIndex >= pdf.numPages)) throw new Error('Project references a missing PDF page.')
        } finally { await pdf.loadingTask.destroy() }
      }
      // Preview caches are regenerated from trusted compiler output on import.
      for (const page of next.pages) for (const element of page.elements) {
        if (element.kind !== 'typst') continue
        try {
          element.previewSvg = await compileTypstSvg(element.source, element.width, element.height, next.prelude,
            element.topInset ?? DEFAULT_TYPST_TOP_INSET, element.pageFill ?? '')
          element.previewSource = element.source
          element.previewWidth = element.width
          element.previewHeight = element.height
          element.previewPrelude = next.prelude
          element.previewTopInset = element.topInset ?? DEFAULT_TYPST_TOP_INSET
          element.previewPageFill = element.pageFill ?? ''
        } catch (e) { element.error = String(e) }
      }
      await library.create(next)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'That project could not be imported.') }
    finally { setReadingFile(false) }
  }

  const newDocument = (name: string) => {
    const pageId = uid()
    void library.create({
      name,
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
    window.requestAnimationFrame(() => globalThis.document.getElementById(`page-${pageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const deletePage = (pageId: string) => {
    if (document.pages.length === 1) return
    const index = document.pages.findIndex((page) => page.id === pageId)
    updateDocument((current) => ({ ...current, pages: current.pages.filter((page) => page.id !== pageId) }))
    const next = document.pages[index + 1] ?? document.pages[index - 1]
    setActivePageId(next?.id ?? null)
    if (selection?.pageId === pageId) setSelection(null)
  }

  const finishPageDrag = () => {
    draggingPageIdRef.current = null
    setDraggingPageId(null)
    setPageDropTarget(null)
  }

  const createTypst = (pageId: string, box: Box) => {
    const element: TypstElement = {
      id: uid(),
      kind: 'typst',
      ...box,
      source: '',
      topInset: document.defaultTopInset ?? DEFAULT_TYPST_TOP_INSET,
    }
    updateDocument((current) => ({
      ...current,
      pages: current.pages.map((page) => page.id === pageId
        ? { ...page, elements: [...page.elements, element] }
        : page),
    }))
    setSelection({ pageId, elementId: element.id })
    setSourceFocusRequest((request) => request + 1)
    setPreludeOpen(false)
    setTool('select')
  }

  const dropElement = useCallback((sourcePageId: string, element: ImageElement | TypstElement, drop: ObjectDrop) => {
    const sourcePage = document.pages.find((page) => page.id === sourcePageId)
    if (!sourcePage) return

    let destinationPageId = sourcePageId
    let destinationShell: HTMLElement | null = null
    for (const shell of globalThis.document.querySelectorAll<HTMLElement>('[data-page-id]')) {
      const rect = shell.getBoundingClientRect()
      if (drop.clientX >= rect.left && drop.clientX <= rect.right
        && drop.clientY >= rect.top && drop.clientY <= rect.bottom) {
        destinationPageId = shell.dataset.pageId || sourcePageId
        destinationShell = shell
        break
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
    const bounded = {
      ...element,
      x: Math.max(0, Math.min(destinationPage.width - element.width, x)),
      y: Math.max(0, Math.min(destinationPage.height - element.height, y)),
    }

    const moved = alignment.snapEnabled && !drop.disableSnap
      ? snapBoxPosition(bounded, destinationPage, zoom, element.id).box : bounded

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
  }, [alignment.snapEnabled, document.pages, updateDocument, zoom])

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

  const addImages = useCallback(async (files: File[], targetPageId?: string, dropPoint?: Point) => {
    const images = files.filter(isSupportedImageFile)
    if (!images.length) {
      setNotice('Choose a PNG, JPEG, WebP, or GIF image.')
      return
    }
    const createProject = library.libraryOpen || !document.pages.length
    const target = createProject ? undefined : document.pages.find((page) => page.id === targetPageId)
      ?? document.pages.find((page) => page.id === activePageId)
      ?? document.pages[0]
    const pageId = target?.id ?? uid()
    const epoch = documentEpochRef.current
    try {
      const decoded = await Promise.all(images.map(decodeImageFile))
      if (documentEpochRef.current !== epoch) return
      const elements = decoded.map((image, index) => placeImage(image, target ?? LETTER_PAGE, dropPoint, index * 16))
      if (createProject) {
        await library.create({ name: images[0].name.replace(/\.[^.]+$/, '') || 'Image document', prelude: '', originalPdf: null,
          pages: [{ id: pageId, sourceIndex: null, ...LETTER_PAGE, elements }], updatedAt: Date.now() })
      } else {
        updateDocument((current) => {
          if (!current.pages.some((page) => page.id === pageId)) return current
          return {
            ...current,
            pages: current.pages.map((page) => page.id === pageId
              ? { ...page, elements: [...page.elements, ...elements] }
              : page),
          }
        })
      }
      setActivePageId(pageId)
      setSelection({ pageId, elementId: elements[elements.length - 1].id })
      setPreludeOpen(false)
      setTool('select')
      if (images.length < files.length) setNotice('Some files were skipped. Only PNG, JPEG, WebP, and GIF images are supported.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The image could not be added.')
    }
  }, [activePageId, document.pages, library, updateDocument])

  useEffect(() => {
    const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
    const targetPage = (target: EventTarget | null) => target instanceof Element
      ? target.closest<HTMLElement>('.page-shell[data-page-id], .page-thumbnail[data-page-id]')
      : null
    const onPaste = (event: ClipboardEvent) => {
      const itemFiles = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
      const files = itemFiles.length ? itemFiles : Array.from(event.clipboardData?.files ?? [])
        .filter((file) => file.type.startsWith('image/'))
      if (!files.length) return
      event.preventDefault()
      void addImages(files)
    }
    const onDragOver = (event: DragEvent) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setImageDropTarget(targetPage(event.target)?.dataset.pageId ?? null)
    }
    const onDrop = (event: DragEvent) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      setImageDropTarget(null)
      const files = Array.from(event.dataTransfer?.files ?? [])
      const target = targetPage(event.target)
      const pageId = target?.dataset.pageId
      const point = target?.classList.contains('page-shell')
        && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
        ? { x: (event.clientX - target.getBoundingClientRect().left) / zoom,
          y: (event.clientY - target.getBoundingClientRect().top) / zoom }
        : undefined
      void addImages(files, pageId, point)
    }
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget) return
      setImageDropTarget(null)
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragleave', onDragLeave)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragleave', onDragLeave)
    }
  }, [addImages, zoom])

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
      if (busy || library.libraryOpen) return
      const target = event.target instanceof HTMLElement ? event.target : null
      const editing = !!target && (target.isContentEditable || !!target.closest('textarea, input, select, [contenteditable], .inspector'))
      if (!editing && selection && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const page = document.pages.find((candidate) => candidate.id === selection.pageId)
        const element = page?.elements.find((candidate) => candidate.id === selection.elementId)
        if (page && element && element.kind !== 'stroke' && event.key.startsWith('Arrow')) {
          const moved = nudgeElement(element, page, event.key, event.shiftKey)
          if (moved) {
            event.preventDefault()
            if (moved !== element) updateElement(page.id, moved)
          }
        }
      }
      if (!editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
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

  const fileInputs = <>
    <input ref={openInputRef} hidden type="file" accept="application/pdf" onChange={(event) => { void openPdf(event.target.files?.[0]); event.target.value = '' }} />
    <input ref={projectInputRef} hidden type="file" accept=".typstability,application/json" onChange={(event) => { void importProject(event.target.files?.[0]); event.target.value = '' }} />
  </>
  const alert = (notice || library.error) && <div className="notice" role="alert">{notice || library.error}<button aria-label="Dismiss notice" onClick={() => { setNotice(null); library.clearError() }}>×</button></div>
  const busyIndicator = busy && <div className="busy-overlay" role="status"><RotateCcw className="spin" size={18} /> Working…</div>
  if (!library.ready) return <main className="loading-screen"><RotateCcw className="spin" size={18} /> Loading projects…</main>
  if (library.libraryOpen || !document.pages.length) return <>
    <ProjectLibrary projects={library.projects} activeId={library.activeId} busy={busy}
      onClose={library.closeLibrary} onNew={newDocument}
      onPdf={() => openInputRef.current?.click()} onImport={() => projectInputRef.current?.click()}
      onOpen={(id) => void library.open(id)} onRename={(id, name) => void library.rename(id, name)}
      onDuplicate={(id) => void library.duplicate(id)} onDelete={(id) => void library.remove(id)} />
    {fileInputs}{alert}{busyIndicator}
  </>

  return (
    <div className="app-shell">
      <Toolbar
        name={document.name}
        onRename={(name) => { if (name !== document.name) updateDocument((current) => ({ ...current, name }), false) }}
        saveStatus={library.status}
        onProjects={() => void library.showLibrary()}
        onExportProject={() => { try { downloadProject(document) } catch (e) { setNotice(String(e)) } }}
        tool={tool}
        canUndo={documentHistory.canUndo}
        canRedo={documentHistory.canRedo}
        exporting={exporting}
        penColor={penColor}
        penRadius={penRadius}
        eraserRadius={eraserRadius}
        showGrid={alignment.showGrid}
        snapEnabled={alignment.snapEnabled}
        onGrid={alignment.toggleGrid}
        onSnap={alignment.toggleSnap}
        preludeOpen={preludeOpen}
        onImage={() => imageInputRef.current?.click()}
        onTool={setChosenTool}
        onBlankPage={insertBlankPage}
        onUndo={documentHistory.undo}
        onRedo={documentHistory.redo}
        onExport={() => void doExport()}
        onPenColor={setPenColor}
        onPenRadius={setPenRadius}
        onEraserRadius={setEraserRadius}
        onPrelude={() => setPreludeOpen((open) => !open)}
      />
      <div className="workspace">
        <nav className={`page-rail ${thumbnailsOpen ? '' : 'is-collapsed'}`} aria-label="Pages">
          <div className="rail-heading">
            {thumbnailsOpen && <span>Pages <small>{document.pages.length}</small></span>}
            <button className="rail-toggle" onClick={() => setThumbnailsOpen((open) => !open)}
              title={thumbnailsOpen ? 'Hide pages' : 'Show pages'} aria-label={thumbnailsOpen ? 'Hide pages' : 'Show pages'}>
              {thumbnailsOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
            </button>
          </div>
          {thumbnailsOpen && <>
            {document.pages.map((page, index) => (
              <div className={[
                'page-thumbnail', activePage?.id === page.id ? 'is-active' : '',
                draggingPageId === page.id ? 'is-dragging' : '',
                pageDropTarget?.pageId === page.id ? `drop-${pageDropTarget.side}` : '',
              ].filter(Boolean).join(' ')} key={page.id} data-page-id={page.id} draggable={document.pages.length > 1}
                onDragStart={(event) => {
                  if ((event.target as HTMLElement).closest('.thumbnail-delete')) { event.preventDefault(); return }
                  draggingPageIdRef.current = page.id
                  setDraggingPageId(page.id)
                  setPageDropTarget(null)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', page.id)
                }}
                onDragOver={(event) => {
                  if (!draggingPageIdRef.current || draggingPageIdRef.current === page.id) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  const side = thumbnailDropSide(event)
                  setPageDropTarget((current) => current?.pageId === page.id && current.side === side
                    ? current : { pageId: page.id, side })
                }}
                onDrop={(event) => {
                  const draggedId = draggingPageIdRef.current
                  if (!draggedId) return
                  event.preventDefault()
                  const side = thumbnailDropSide(event)
                  if (reorderPages(document.pages, draggedId, page.id, side) !== document.pages) {
                    updateDocument((current) => ({ ...current,
                      pages: reorderPages(current.pages, draggedId, page.id, side) }))
                  }
                  finishPageDrag()
                }}
                onDragEnd={finishPageDrag}>
                <button className="thumbnail-select" aria-label={`Go to page ${index + 1}`} aria-current={activePage?.id === page.id ? 'page' : undefined}
                  onClick={() => {
                    setActivePageId(page.id)
                    globalThis.document.getElementById(`page-${page.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }}>
                  <PageThumbnail page={page} pdf={pdfProxy} />
                  <span className="thumbnail-number">{index + 1}</span>
                </button>
                {document.pages.length > 1 && <button className="thumbnail-delete" title={`Delete page ${index + 1}`} aria-label={`Delete page ${index + 1}`} onClick={() => deletePage(page.id)}><Trash2 size={12} /></button>}
              </div>
            ))}
            <button className="add-page-button" onClick={insertBlankPage} title="Insert a blank page after the current page"><Plus size={15} /> Add page</button>
          </>}
        </nav>
        <main ref={documentScrollRef} className={`document-scroll ${selectedTypst || selectedImage || preludeOpen ? 'with-inspector' : ''}`}>
          {document.pages.map((page, index) => (
            <div id={`page-${page.id}`} key={page.id} className={`page-positioner ${imageDropTarget === page.id ? 'is-image-drop-target' : ''}`}>
              <CanvasPage
                page={page}
                pageNumber={index + 1}
                pdf={pdfProxy}
                zoom={zoom}
                tool={tool}
                selection={selection}
                showGrid={alignment.showGrid}
                snapEnabled={alignment.snapEnabled}
                penColor={penColor}
                penRadius={penRadius}
                eraserRadius={eraserRadius}
                onActivate={() => setActivePageId(page.id)}
                onSelect={(elementId) => {
                  setPreludeOpen(false)
                  setSelection(elementId ? { pageId: page.id, elementId } : null)
                  if (elementId) {
                    setTool('select')
                    setSourceFocusRequest((request) => request + 1)
                  }
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
            prelude={document.prelude}
            documentKey={`${library.activeId}:box:${selectedTypst.id}`}
            sessions={editorSessions}
            focusRequest={sourceFocusRequest}
            onSourceChange={(source) => updateElement(selection.pageId, { ...selectedTypst, source, error: undefined })}
            onTopInsetChange={(topInset) => updateElement(selection.pageId, { ...selectedTypst, topInset })}
            onDocumentStyles={() => setPreludeOpen(true)}
            onPageFillChange={(pageFill) => updateElement(selection.pageId, { ...selectedTypst, pageFill })}
            onDelete={deleteSelection}
            onClose={() => setSelection(null)}
          />
        )}
        {!preludeOpen && selectedImage && selection && (
          <ImageInspector
            key={`${selectedImage.id}:${JSON.stringify(selectedImage.crop)}`}
            element={selectedImage}
            onChange={(element) => updateElement(selection.pageId, element)}
            onDelete={deleteSelection}
            onClose={() => setSelection(null)}
          />
        )}
        {preludeOpen && (
          <PreludeInspector
            source={document.prelude}
            defaultTopInset={document.defaultTopInset ?? DEFAULT_TYPST_TOP_INSET}
            onDefaultTopInsetChange={(defaultTopInset) => updateDocument((current) => ({ ...current, defaultTopInset }))}
            onApplyPadding={() => updateDocument((current) => ({ ...current, pages: current.pages.map((page) => ({
              ...page, elements: page.elements.map((element) => element.kind === 'typst'
                ? { ...element, topInset: current.defaultTopInset ?? DEFAULT_TYPST_TOP_INSET } : element),
            })) }))}
            documentKey={`${library.activeId}:prelude`}
            sessions={editorSessions}
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
              <img src={dragPreview.element.dataUrl} alt="" style={imageCropStyle(dragPreview.element)} />
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
      <footer className="editor-statusbar">
        <span className="page-count">Page {Math.max(1, document.pages.findIndex((page) => page.id === activePage?.id) + 1)} of {document.pages.length}</span>
        <AgentAccess {...agentAccess} />
        <span className="tool-hint">{tool === 'typst' ? 'Drag to add a text box; click a box to edit.' : tool === 'pen' ? 'Drag to draw. Your strokes save automatically.' : tool === 'eraser' ? 'Drag over pen strokes to erase them.' : 'Click to edit. Drag corners to resize; hold Shift to keep proportions.'}</span>
        <div className="zoom-control">
          <button className="fit-page" onClick={() => {
            const viewport = documentScrollRef.current
            if (!viewport || !activePage) return
            const width = viewport.clientWidth - parseFloat(getComputedStyle(viewport).paddingRight) - 48
            setZoom(Math.max(0.1, Math.min(5, width / activePage.width, (viewport.clientHeight - 72) / activePage.height)))
            window.requestAnimationFrame(() => globalThis.document.getElementById(`page-${activePage.id}`)?.scrollIntoView({ block: 'center' }))
          }}>Fit page</button>
          <button onClick={() => setZoom((value) => Math.max(0.1, value - 0.1))} disabled={zoom <= 0.1} aria-label="Zoom out"><ZoomOut size={15} /></button>
          <button className="zoom-reset" onClick={() => setZoom(1)} title="Reset zoom to 100%">{Math.round(zoom * 100)}%</button>
          <button onClick={() => setZoom((value) => Math.min(5, value + 0.1))} disabled={zoom >= 5} aria-label="Zoom in"><ZoomIn size={15} /></button>
        </div>
      </footer>
      {alert}{fileInputs}{busyIndicator}
      <input ref={imageInputRef} hidden type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => {
        void addImages(Array.from(event.target.files ?? []))
        event.target.value = ''
      }} />
    </div>
  )
}

export default App
