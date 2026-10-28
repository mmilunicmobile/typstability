import type { LspDiagnostic, LspRange, Position } from './diagnostics'

export type TextEdit = { range: LspRange; newText: string }
export type CompletionItem = {
  label: string
  kind?: number
  detail?: string
  documentation?: string | { kind: string; value: string }
  insertText?: string
  insertTextFormat?: number
  textEdit?: TextEdit | { insert: LspRange; replace: LspRange; newText: string }
  additionalTextEdits?: TextEdit[]
  sortText?: string
  filterText?: string
}
export type Hover = { contents: string | { value: string; language?: string } | (string | { value: string; language?: string })[]; range?: LspRange }
type RpcMessage = { id?: number | string; method?: string; params?: any; result?: any; error?: { message: string; code: number } }
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

export function validateLspUrl(value: string) {
  const url = new URL(value)
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Use a ws:// or wss:// bridge URL.')
  if (url.protocol === 'ws:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Unencrypted connections must use localhost. Use wss:// for a remote bridge.')
  }
  if (url.username || url.password) throw new Error('Use the token in the bridge URL, not a username or password.')
  return url.href
}

// A deliberately small JSON-RPC client. Each editor owns one Tinymist process
// through the loopback bridge, and closes it when switching documents.
export class TypstLspClient {
  readonly socket: WebSocket
  uri = ''
  version = 0
  completionTriggers: string[] = []
  private nextId = 0
  private pending = new Map<number | string, Pending>()
  private opened = false
  private disposed = false
  private workspaceReady: Promise<{ rootUri: string; fontPaths: string[] }>
  private resolveWorkspace!: (workspace: { rootUri: string; fontPaths: string[] }) => void
  private rejectWorkspace!: (error: Error) => void
  private workspaceTimer: ReturnType<typeof setTimeout>

  constructor(
    endpoint: string,
    private onDiagnostics: (diagnostics: LspDiagnostic[]) => void,
    private onDisconnect: (reason: string) => void,
  ) {
    // Construct first: browsers can synchronously reject a blocked URL. Do not
    // leave a pending initialization promise/timer behind in that case.
    this.socket = new WebSocket(validateLspUrl(endpoint))
    this.workspaceReady = new Promise((resolve, reject) => { this.resolveWorkspace = resolve; this.rejectWorkspace = reject })
    this.workspaceTimer = setTimeout(() => this.fail('The language server bridge did not respond.'), 10000)
    this.socket.onmessage = (event) => {
      try { this.receive(JSON.parse(String(event.data)) as RpcMessage) }
      catch { this.fail('The language server sent an invalid message.') }
    }
    this.socket.onerror = () => this.fail('Cannot reach Tinymist. Start the bridge and reconnect.')
    this.socket.onclose = () => this.fail('Tinymist disconnected. Start the bridge and reconnect.')
  }

  private send(message: RpcMessage) {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('Tinymist is disconnected.')
    this.socket.send(JSON.stringify({ jsonrpc: '2.0', ...message }))
  }

  private receive(message: RpcMessage) {
    if (message.method) {
      if (message.method === 'typstability/ready') {
        clearTimeout(this.workspaceTimer)
        const root = message.params?.rootUri
        if (typeof root !== 'string' || !root.startsWith('file:///')) { this.fail('Invalid bridge workspace.'); return }
        this.resolveWorkspace({ rootUri: root, fontPaths: message.params.fontPaths ?? [] })
      } else if (message.method === 'textDocument/publishDiagnostics' && message.params?.uri === this.uri) {
        if (message.params.version === undefined || message.params.version === this.version) this.onDiagnostics(message.params.diagnostics ?? [])
      } else if (message.id !== undefined) {
        if (message.method === 'workspace/configuration') {
          this.send({ id: message.id, result: (message.params?.items ?? []).map(() => ({ exportPdf: 'never' })) })
        } else if (['client/registerCapability', 'client/unregisterCapability', 'window/workDoneProgress/create'].includes(message.method)) {
          this.send({ id: message.id, result: null })
        } else if (message.method === 'workspace/applyEdit') {
          this.send({ id: message.id, result: { applied: false, failureReason: 'Only completion edits in the active source are supported.' } })
        } else this.send({ id: message.id, error: { code: -32601, message: `Unsupported request: ${message.method}` } })
      }
      return
    }
    if (message.id === undefined) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) pending.reject(new Error(message.error.message))
    else pending.resolve(message.result)
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      const timer = setTimeout(() => {
        this.pending.delete(id)
        if (this.socket.readyState === WebSocket.OPEN) this.send({ method: '$/cancelRequest', params: { id } })
        reject(new Error(`Tinymist timed out: ${method}`))
      }, 10000)
      this.pending.set(id, { resolve, reject, timer })
      try { this.send({ id, method, params }) }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }

  async start(documentKey: string, text: string) {
    const { rootUri, fontPaths } = await this.workspaceReady
    if (this.disposed) throw new Error('Editor closed.')
    this.uri = `${rootUri.replace(/\/$/, '')}/${encodeURIComponent(documentKey)}.typ`
    const result = await this.request<{ capabilities?: { positionEncoding?: string; completionProvider?: { triggerCharacters?: string[] } } }>('initialize', {
      processId: null,
      clientInfo: { name: 'Typstability', version: '0.1.0' },
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: 'Typstability' }],
      capabilities: {
        general: { positionEncodings: ['utf-16'] },
        workspace: { configuration: true },
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: false },
          completion: { completionItem: { snippetSupport: true, insertReplaceSupport: true, documentationFormat: ['plaintext'] } },
          hover: { contentFormat: ['plaintext'] },
          publishDiagnostics: { versionSupport: true },
        },
      },
      initializationOptions: { exportPdf: 'never', formatterMode: 'disable', semanticTokens: 'disable', fontPaths },
    })
    if (result.capabilities?.positionEncoding && result.capabilities.positionEncoding !== 'utf-16') throw new Error('Tinymist must support UTF-16 positions.')
    this.completionTriggers = result.capabilities?.completionProvider?.triggerCharacters ?? []
    this.send({ method: 'initialized', params: {} })
    this.version = 1
    this.send({ method: 'textDocument/didOpen', params: { textDocument: { uri: this.uri, languageId: 'typst', version: this.version, text } } })
    this.opened = true
  }

  update(text: string) {
    if (!this.opened || this.disposed) return
    this.version++
    this.onDiagnostics([])
    try { this.send({ method: 'textDocument/didChange', params: { textDocument: { uri: this.uri, version: this.version }, contentChanges: [{ text }] } }) }
    catch { this.fail('Tinymist disconnected. Start the bridge and reconnect.') }
  }

  async complete(position: Position, trigger?: string) {
    return this.request<CompletionItem[] | { items: CompletionItem[]; isIncomplete?: boolean } | null>('textDocument/completion', {
      textDocument: { uri: this.uri }, position,
      context: trigger ? { triggerKind: 2, triggerCharacter: trigger } : { triggerKind: 1 },
    })
  }

  hover(position: Position) {
    return this.request<Hover | null>('textDocument/hover', { textDocument: { uri: this.uri }, position })
  }

  private fail(reason: string) {
    if (this.disposed) return
    this.rejectWorkspace(new Error(reason))
    this.onDisconnect(reason)
    this.dispose()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    clearTimeout(this.workspaceTimer)
    this.rejectWorkspace(new Error('Editor closed.'))
    this.pending.forEach(({ reject, timer }) => { clearTimeout(timer); reject(new Error('Tinymist disconnected.')) })
    this.pending.clear()
    if (this.socket.readyState === WebSocket.OPEN) {
      if (this.opened) this.send({ method: 'textDocument/didClose', params: { textDocument: { uri: this.uri } } })
      // The bridge owns the process and terminates it when the socket closes.
      this.socket.close()
    } else if (this.socket.readyState === WebSocket.CONNECTING) this.socket.close()
  }
}

export function hoverText(contents: Hover['contents']): string {
  if (Array.isArray(contents)) return contents.map(hoverText).join('\n\n')
  return typeof contents === 'string' ? contents : contents.value
}
