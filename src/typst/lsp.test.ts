import { afterEach, describe, expect, it, vi } from 'vitest'
import { TypstLspClient, hoverText, validateLspUrl } from './lsp'

class FakeSocket {
  static OPEN = 1
  static CONNECTING = 0
  static instances: FakeSocket[] = []
  readyState = 1
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  sent: any[] = []
  constructor() { FakeSocket.instances.push(this) }
  send(value: string) { this.sent.push(JSON.parse(value)) }
  close() { this.readyState = 3 }
  receive(value: any) { this.onmessage?.({ data: JSON.stringify(value) }) }
}

afterEach(() => { vi.unstubAllGlobals(); FakeSocket.instances = [] })

async function connect() {
  vi.stubGlobal('WebSocket', FakeSocket)
  const diagnostics = vi.fn()
  const disconnected = vi.fn()
  const client = new TypstLspClient('ws://127.0.0.1:2087/?token=test', diagnostics, disconnected)
  const socket = FakeSocket.instances[0]
  const ready = client.start('project:box:1', '#let local = 1')
  socket.receive({ method: 'typstability/ready', params: { rootUri: 'file:///tmp/typstability-test', fontPaths: ['/fonts'] } })
  await Promise.resolve()
  expect(socket.sent[0]).toMatchObject({ method: 'initialize', params: { capabilities: { general: { positionEncodings: ['utf-16'] } }, initializationOptions: { exportPdf: 'never', fontPaths: ['/fonts'] } } })
  socket.receive({ id: socket.sent[0].id, result: { capabilities: { positionEncoding: 'utf-16', completionProvider: { triggerCharacters: ['#', '.'] } } } })
  await ready
  return { client, socket, diagnostics, disconnected }
}

describe('Tinymist protocol client', () => {
  it('initializes, opens, syncs versions, requests real completions/hover, and closes', async () => {
    const { client, socket } = await connect()
    expect(client.uri).toBe('file:///tmp/typstability-test/project%3Abox%3A1.typ')
    expect(socket.sent.slice(1).map((message) => message.method)).toEqual(['initialized', 'textDocument/didOpen'])
    client.update('#let local = 2\n#loc')
    expect(socket.sent.at(-1)).toMatchObject({ method: 'textDocument/didChange', params: { textDocument: { version: 2 }, contentChanges: [{ text: '#let local = 2\n#loc' }] } })
    const completion = client.complete({ line: 1, character: 4 })
    expect(socket.sent.at(-1)).toMatchObject({ method: 'textDocument/completion', params: { position: { line: 1, character: 4 } } })
    socket.receive({ id: socket.sent.at(-1).id, result: { items: [{ label: 'local', detail: '2' }] } })
    await expect(completion).resolves.toEqual({ items: [{ label: 'local', detail: '2' }] })
    const hover = client.hover({ line: 1, character: 2 })
    socket.receive({ id: socket.sent.at(-1).id, result: { contents: { kind: 'plaintext', value: '2' } } })
    await expect(hover).resolves.toMatchObject({ contents: { value: '2' } })
    client.dispose()
    expect(socket.sent.at(-1)).toMatchObject({ method: 'textDocument/didClose' })
    expect(socket.readyState).toBe(3)
  })

  it('ignores old diagnostic versions and other files, clears on changes, and handles requests', async () => {
    const { client, socket, diagnostics } = await connect()
    const publish = (uri: string, version: number) => socket.receive({ method: 'textDocument/publishDiagnostics', params: { uri, version, diagnostics: [{ message: 'Error' }] } })
    publish('file:///other.typ', 1)
    publish(client.uri, 0)
    expect(diagnostics).not.toHaveBeenCalled()
    publish(client.uri, 1)
    expect(diagnostics).toHaveBeenLastCalledWith([{ message: 'Error' }])
    client.update('Changed')
    expect(diagnostics).toHaveBeenLastCalledWith([])
    publish(client.uri, 1)
    expect(diagnostics).toHaveBeenCalledTimes(2)
    socket.receive({ id: 'settings', method: 'workspace/configuration', params: { items: [{ section: 'tinymist' }] } })
    expect(socket.sent.at(-1)).toMatchObject({ id: 'settings', result: [{ exportPdf: 'never' }] })
    socket.receive({ id: 90, method: 'workspace/applyEdit', params: {} })
    expect(socket.sent.at(-1).result.applied).toBe(false)
    client.dispose()
  })

  it('rejects pending requests and clears timers on disconnect', async () => {
    const { client, socket, disconnected } = await connect()
    const request = client.hover({ line: 0, character: 0 })
    socket.onclose?.()
    await expect(request).rejects.toThrow('disconnected')
    expect(disconnected).toHaveBeenCalledWith(expect.stringContaining('disconnected'))
  })

  it('preserves source updates when a socket has closed before the close event arrives', async () => {
    const { client, socket, disconnected } = await connect()
    socket.readyState = 3
    expect(() => client.update('New source')).not.toThrow()
    expect(disconnected).toHaveBeenCalledWith(expect.stringContaining('disconnected'))
  })

  it('reports synchronous browser connection blocks without starting a timer', () => {
    vi.stubGlobal('WebSocket', class { constructor() { throw new Error('Browser blocked mixed content') } })
    expect(() => new TypstLspClient('ws://localhost:2087', vi.fn(), vi.fn())).toThrow('Browser blocked')
  })

  it('rejects non-WebSocket and insecure remote endpoints', () => {
    expect(() => validateLspUrl('https://localhost')).toThrow('ws://')
    expect(() => validateLspUrl('ws://example.com')).toThrow('localhost')
    expect(validateLspUrl('wss://example.com/lsp')).toBe('wss://example.com/lsp')
    expect(validateLspUrl('ws://localhost:2087/?token=a')).toContain('token=a')
  })

  it('treats hover markup as text', () => {
    expect(hoverText([{ language: 'typst', value: '#let x = 1' }, '<script>unsafe()</script>'])).toBe('#let x = 1\n\n<script>unsafe()</script>')
  })
})
