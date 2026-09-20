import { createTypstCompiler, createTypstRenderer, loadFonts } from '@myriaddreamin/typst.ts'
import { CompileFormatEnum, type IncrementalServer, type TypstCompiler } from '@myriaddreamin/typst.ts/compiler'
import type { RenderSession, TypstRenderer } from '@myriaddreamin/typst.ts/renderer'
import compilerWasm from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url'
import rendererWasm from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url'
import regularFont from '../assets/fonts/NewCM10-Regular.otf?url'
import boldFont from '../assets/fonts/NewCM10-Bold.otf?url'
import italicFont from '../assets/fonts/NewCM10-Italic.otf?url'
import mathFont from '../assets/fonts/NewCMMath-Regular.otf?url'

type Request = {
  id: number
  format: 'svg' | 'pdf'
  source: string
  prelude: string
  width: number
  height: number
}

type Runtime = {
  compiler: TypstCompiler
  renderer: TypstRenderer
  incrementalServer?: IncrementalServer
  incrementalReady?: Promise<IncrementalServer>
  renderSession?: RenderSession
  renderSessionReady?: Promise<RenderSession>
}

let runtimePromise: Promise<Runtime> | undefined
let workQueue = Promise.resolve()

async function initialize() {
  if (runtimePromise) return runtimePromise
  runtimePromise = (async () => {
    const compiler = createTypstCompiler()
    const renderer = createTypstRenderer()
    const fontData = await Promise.all([regularFont, boldFont, italicFont, mathFont].map(async (url) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Could not load bundled font: ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    }))
    await compiler.init({
      getModule: () => compilerWasm,
      beforeBuild: [loadFonts(fontData, { assets: false })],
    })
    await renderer.init({ getModule: () => rendererWasm })

    return { compiler, renderer }
  })()
  return runtimePromise
}

async function getIncrementalServer(runtime: Runtime) {
  if (runtime.incrementalServer) return runtime.incrementalServer
  if (!runtime.incrementalReady) {
    runtime.incrementalReady = new Promise<IncrementalServer>((resolve) => {
      // Keep the callback pending for the worker's lifetime so Typst retains
      // parsed syntax, fonts, layout cache, and incremental compilation state.
      void runtime.compiler.withIncrementalServer(async (incrementalServer) => {
        runtime.incrementalServer = incrementalServer
        resolve(incrementalServer)
        await new Promise<void>(() => undefined)
      })
    })
  }
  return runtime.incrementalReady
}

async function getRenderSession(runtime: Runtime) {
  if (runtime.renderSession) return runtime.renderSession
  if (!runtime.renderSessionReady) {
    runtime.renderSessionReady = new Promise<RenderSession>((resolve) => {
      // The renderer must retain its document state so it can merge the
      // incremental vector patches emitted by the compiler.
      void runtime.renderer.runWithSession(async (renderSession) => {
        runtime.renderSession = renderSession
        resolve(renderSession)
        await new Promise<void>(() => undefined)
      })
    })
  }
  return runtime.renderSessionReady
}

function wrapSource(source: string, prelude: string, width: number, height: number) {
  return `#set text(font: "New Computer Modern", size: 12pt)\n${prelude}\n#set page(width: ${width}pt, height: ${height}pt, margin: 0pt, fill: none)\n#block(width: 100%, height: 100%, clip: true)[\n${source}\n]`
}

async function processRequest({ id, format, source, prelude, width, height }: Request) {
  let stage = 'initialize runtime'
  try {
    const runtime = await initialize()
    const mainContent = wrapSource(source, prelude, width, height)
    if (format === 'svg') {
      stage = 'update source'
      runtime.compiler.addSource('/preview.typ', mainContent)
      stage = 'start incremental compiler'
      const incrementalServer = await getIncrementalServer(runtime)
      stage = 'incremental compile'
      const compiled = await runtime.compiler.compile({
        mainFilePath: '/preview.typ',
        incrementalServer,
        diagnostics: 'unix',
      })
      if (!compiled.result && compiled.diagnostics?.length) {
        throw new Error(compiled.diagnostics.join('\n'))
      }
      if (!compiled.result) throw new Error('Typst did not produce a preview update.')
      stage = 'merge incremental preview'
      const renderSession = await getRenderSession(runtime)
      renderSession.manipulateData({ action: 'merge', data: compiled.result })
      stage = 'render SVG preview'
      const svg = await renderSession.renderSvg({
        data_selection: { body: true, defs: true, css: true, js: false },
      })
      self.postMessage({ id, ok: true, result: svg })
    } else {
      stage = 'compile PDF'
      runtime.compiler.addSource('/export.typ', mainContent)
      const compiled = await runtime.compiler.compile({
        mainFilePath: '/export.typ',
        format: CompileFormatEnum.pdf,
        diagnostics: 'unix',
      })
      if (!compiled.result) {
        throw new Error(compiled.diagnostics?.join('\n') || 'Typst did not produce a PDF.')
      }
      self.postMessage({ id, ok: true, result: compiled.result }, [compiled.result.buffer])
    }
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: `${stage}: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
}

self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data
  workQueue = workQueue.then(() => processRequest(request), () => processRequest(request))
}
