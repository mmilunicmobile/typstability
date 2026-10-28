import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'

const args = process.argv.slice(2)
function option(name, fallback) {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} needs a value`)
  return args[index + 1]
}
const port = Number(option('--port', '2087'))
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid --port')
const allowedOrigins = new Set(option('--origin', 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173').split(',').map((origin) => new URL(origin).origin))
const token = randomBytes(32).toString('hex')
const binary = option('--tinymist', 'tinymist')
const fontDirectory = resolve(fileURLToPath(new URL('../src/assets/fonts', import.meta.url)))
const maxMessageBytes = 10 * 1024 * 1024
const sessions = new Set()

const server = new WebSocketServer({
  host: '127.0.0.1', port, maxPayload: maxMessageBytes,
  verifyClient({ req }) {
    const url = new URL(req.url, 'http://127.0.0.1')
    return url.pathname === '/' && url.searchParams.get('token') === token && allowedOrigins.has(req.headers.origin)
  },
})
server.on('listening', () => {
  const address = server.address()
  console.log(`Tinymist bridge: ws://127.0.0.1:${address.port}/?token=${token}`)
  console.log(`Allowed app origins: ${[...allowedOrigins].join(', ')}`)
  console.log('Paste the URL into Typst intelligence in the source editor. Ctrl+C stops the bridge.')
})
server.on('error', (error) => { console.error(`Bridge failed: ${error.message}`); process.exitCode = 1 })

server.on('connection', async (socket) => {
  let child
  let directory
  let disposed = false
  let pending = Buffer.alloc(0)
  let contentLength = null
  const close = () => {
    if (disposed) return
    disposed = true
    sessions.delete(close)
    child?.stdin.destroy()
    child?.kill()
    if (directory) void rm(directory, { recursive: true, force: true })
  }
  sessions.add(close)
  socket.on('close', close)
  socket.on('error', close)
  try {
    directory = await mkdtemp(join(tmpdir(), 'typstability-lsp-'))
    if (disposed) { await rm(directory, { recursive: true, force: true }); return }
    child = spawn(binary, ['lsp'], { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'] })
    child.on('error', (error) => {
      console.error(`Could not start ${binary}: ${error.message}`)
      socket.close(1011, 'Could not start Tinymist. Install it or use --tinymist /path/to/tinymist.')
      close()
    })
    child.on('exit', () => { socket.close(1011, 'Tinymist stopped. Check the bridge terminal.'); close() })
    child.stderr.on('data', (data) => process.stderr.write(data))
    child.stdout.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk])
      try {
        while (pending.length) {
          if (contentLength === null) {
            const boundary = pending.indexOf('\r\n\r\n')
            if (boundary < 0) {
              if (pending.length > 8192) throw new Error('Invalid LSP header')
              break
            }
            const header = pending.subarray(0, boundary).toString('ascii')
            const match = /^Content-Length:\s*(\d+)\s*$/im.exec(header)
            if (!match) throw new Error('Missing LSP Content-Length')
            contentLength = Number(match[1])
            if (contentLength > maxMessageBytes) throw new Error('LSP message too large')
            pending = pending.subarray(boundary + 4)
          }
          if (pending.length < contentLength) break
          const body = pending.subarray(0, contentLength).toString('utf8')
          pending = pending.subarray(contentLength)
          contentLength = null
          JSON.parse(body)
          if (socket.readyState === WebSocket.OPEN) socket.send(body)
        }
      } catch (error) {
        console.error(error.message)
        socket.close(1011, 'Invalid language server response')
        close()
      }
    })
    socket.on('message', (data, isBinary) => {
      if (disposed) return
      try {
        if (isBinary) throw new Error('JSON text messages required')
        const message = JSON.parse(data.toString())
        if (message.jsonrpc !== '2.0' || Array.isArray(message)) throw new Error('JSON-RPC 2.0 required')
        const body = JSON.stringify(message)
        child.stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
      } catch {
        socket.close(1003, 'Invalid JSON-RPC message')
        close()
      }
    })
    child.stdin.on('error', () => { socket.close(1011, 'Tinymist input closed'); close() })
    socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'typstability/ready', params: { rootUri: pathToFileURL(directory).href, fontPaths: [fontDirectory] } }))
  } catch (error) {
    console.error(`Could not create language server session: ${error.message}`)
    socket.close(1011, 'Could not start language server session')
    close()
  }
})

function shutdown() {
  sessions.forEach((close) => close())
  server.clients.forEach((socket) => socket.terminate())
  server.close()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
