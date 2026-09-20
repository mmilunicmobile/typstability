type Response =
  | { id: number; ok: true; result: string | Uint8Array }
  | { id: number; ok: false; error: string }

const worker = new Worker(new URL('./typst.worker.ts', import.meta.url), { type: 'module' })
let nextId = 0
const pending = new Map<number, {
  resolve: (value: string | Uint8Array) => void
  reject: (reason: Error) => void
}>()

worker.onmessage = (event: MessageEvent<Response>) => {
  const response = event.data
  const request = pending.get(response.id)
  if (!request) return
  pending.delete(response.id)
  if (response.ok) request.resolve(response.result)
  else request.reject(new Error(response.error))
}

worker.onerror = (event) => {
  const error = new Error(event.message || 'The Typst worker stopped unexpectedly.')
  pending.forEach(({ reject }) => reject(error))
  pending.clear()
}

function compile(format: 'svg' | 'pdf', source: string, width: number, height: number, prelude: string) {
  return new Promise<string | Uint8Array>((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    worker.postMessage({ id, format, source, width, height, prelude })
  })
}

export async function compileTypstSvg(source: string, width: number, height: number, prelude = '') {
  return compile('svg', source, width, height, prelude) as Promise<string>
}

export async function compileTypstPdf(source: string, width: number, height: number, prelude = '') {
  return compile('pdf', source, width, height, prelude) as Promise<Uint8Array>
}
