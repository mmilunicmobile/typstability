// Optional real-server smoke test: npm run test:lsp -- /path/to/tinymist
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket } from 'ws'
import ts from 'typescript'

const binary = process.argv[2] || 'tinymist'
const bridge = spawn(process.execPath, ['scripts/tinymist-bridge.mjs', '--port', '0', '--tinymist', binary], { stdio: ['ignore', 'pipe', 'pipe'] })
let bridgeLog = ''
let client
let lastDiagnostics = []
let diagnosticMessages = 0
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Bridge start timed out')), 10000)
    const fail = (error) => { clearTimeout(timer); reject(error) }
    bridge.on('error', fail)
    bridge.on('exit', (code) => fail(new Error(`Bridge exited: ${code}\n${bridgeLog}`)))
    bridge.stderr.on('data', (chunk) => { bridgeLog += chunk.toString() })
    bridge.stdout.on('data', (chunk) => {
      bridgeLog += chunk.toString()
      const url = /Tinymist bridge: (ws:\/\/\S+)/.exec(bridgeLog)
      if (url) { clearTimeout(timer); resolve(url[1]) }
    })
  })
  // Exercise the shipped browser client against the real bridge and Tinymist.
  const source = await readFile(new URL('../src/typst/lsp.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  const { TypstLspClient } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
  async function localModule(path) {
    const text = await readFile(new URL(path, import.meta.url), 'utf8')
    const output = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
  }
  const { mapSource } = await localModule('../src/typst/source.ts')
  const { positionAt, lspDiagnostics } = await localModule('../src/typst/diagnostics.ts')
  async function rejectsConnection(url, origin) {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { origin })
      const timer = setTimeout(() => { socket.terminate(); reject(new Error('Bridge authorization check timed out')) }, 5000)
      socket.on('open', () => { clearTimeout(timer); socket.close(); reject(new Error('Bridge accepted an unauthorized connection')) })
      socket.on('error', () => { clearTimeout(timer); resolve() })
    })
  }
  const invalidToken = new URL(endpoint)
  invalidToken.searchParams.set('token', 'invalid')
  await rejectsConnection(invalidToken.href, 'http://localhost:5173')
  await rejectsConnection(endpoint, 'https://untrusted.example')
  globalThis.WebSocket = class extends WebSocket { constructor(url) { super(url, { origin: 'http://localhost:5173' }) } }
  client = new TypstLspClient(endpoint, (diagnostics) => { lastDiagnostics = diagnostics; diagnosticMessages++ }, (reason) => { bridgeLog += `\n${reason}` })
  const shared = '#let project_answer = 42\n'
  let document = mapSource('#project_ans', shared, 240, 120)
  await client.start('smoke-test', document.text)
  const result = await client.complete(positionAt(document.text, document.source.to))
  const items = Array.isArray(result) ? result : result?.items ?? []
  assert(items.some((item) => item.label === 'project_answer'), 'Real completion must include the shared-style variable')
  document = mapSource('#te', shared, 240, 120)
  client.update(document.text)
  const builtins = await client.complete(positionAt(document.text, document.source.to))
  const builtinItems = Array.isArray(builtins) ? builtins : builtins?.items ?? []
  assert(builtinItems.some((item) => item.label === 'text' && item.textEdit?.newText.includes('text(')), 'Built-in functions must be available with argument placeholders')
  document = mapSource('#project_answer', shared, 240, 120)
  client.update(document.text)
  const hover = await client.hover(positionAt(document.text, document.source.from + 5))
  assert(hover?.contents, 'Real hover must return symbol information')
  document = mapSource('#unknown_typstability_symbol', shared, 240, 120)
  client.update(document.text)
  const deadline = Date.now() + 15000
  while (!lastDiagnostics.some((diagnostic) => diagnostic.message.includes('unknown_typstability_symbol')) && Date.now() < deadline) await delay(100)
  assert(lastDiagnostics.some((diagnostic) => diagnostic.message.includes('unknown_typstability_symbol')), 'Real diagnostics must report unknown symbols')
  assert(lspDiagnostics(lastDiagnostics, document, 'source').some((diagnostic) => diagnostic.from === 1 && diagnostic.to === '#unknown_typstability_symbol'.length), 'Real diagnostic range must map back to the visible source')
  document = mapSource('#project_answer', shared, 240, 120)
  client.update(document.text)
  const beforeClear = diagnosticMessages
  const clearDeadline = Date.now() + 15000
  while ((diagnosticMessages === beforeClear || lastDiagnostics.some((diagnostic) => diagnostic.message.includes('unknown_typstability_symbol'))) && Date.now() < clearDeadline) await delay(100)
  assert(diagnosticMessages > beforeClear, 'The language server must publish fresh diagnostics after the fix')
  assert(!lastDiagnostics.some((diagnostic) => diagnostic.message.includes('unknown_typstability_symbol')), 'Fixing the source must clear diagnostics')
  console.log('Real Tinymist: built-in/shared-style completion, hover, mapped diagnostics, clearing, framing, and bridge authorization passed.')
} catch (error) {
  console.error(error)
  // Tokens are intentionally omitted from failure logs.
  console.error(bridgeLog.replace(/token=[a-f0-9]+/g, 'token=<redacted>'))
  process.exitCode = 1
} finally {
  client?.dispose()
  bridge.kill()
}
